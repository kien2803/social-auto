/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Local filesystem storage backend implementation.
 * Used for self-hosted deployments.
 */

import { promises as fs } from 'node:fs';
import { statfsSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type {
  StorageBackend,
  StorageConfig,
  StorageItem,
  StorageMetadata,
  StorageUploadOptions,
} from './interface.js';

export class LocalStorage implements StorageBackend {
  readonly type = 'local' as const;
  private baseDir: string;
  private quota?: StorageConfig['quota'];
  private uploadingFiles = new Set<string>();

  constructor(config: StorageConfig) {
    if (!config.local?.baseDir) {
      throw new Error('LocalStorage requires local.baseDir in config');
    }
    this.baseDir = config.local.baseDir;
    this.quota = config.quota;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async upload(
    file: Buffer | NodeJS.ReadableStream,
    key: string,
    _options?: StorageUploadOptions,
  ): Promise<string> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Check quota before upload
    if (this.quota?.enforceQuota && this.quota.maxBytes > 0) {
      const usage = await this.getUsage('');
      const fileSize = await this.getFileSize(file);
      if (usage + fileSize > this.quota.maxBytes) {
        throw new Error(`Storage quota exceeded: ${usage + fileSize} bytes > ${this.quota.maxBytes} bytes`);
      }
    }

    this.uploadingFiles.add(filePath);

    try {
      if (Buffer.isBuffer(file)) {
        await fs.writeFile(filePath, file);
      } else {
        await this.streamToFile(file, filePath);
      }
      return key;
    } finally {
      this.uploadingFiles.delete(filePath);
    }
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.resolvePath(key);
    return await fs.readFile(filePath);
  }

  async getPublicUrl(_key: string): Promise<string | null> {
    // Local storage doesn't support public URLs by default
    // Could be extended to serve files via HTTP
    return null;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.unlink(filePath).catch(() => {
      // File might not exist, ignore error
    });
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    const filePath = this.resolvePath(key);
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        lastModified: stats.mtimeMs,
        contentType: undefined, // Local storage doesn't track MIME type
      };
    } catch {
      return null;
    }
  }

  async list(prefix: string, limit?: number): Promise<StorageItem[]> {
    const dirPath = this.resolvePath(prefix);
    const items: StorageItem[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (limit && items.length >= limit) break;
        
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fs.stat(fullPath);
        
        items.push({
          key: path.join(prefix, entry.name),
          size: stats.size,
          lastModified: stats.mtimeMs,
          isDirectory: entry.isDirectory(),
        });
      }
    } catch {
      // Directory might not exist
    }

    return items;
  }

  async getUsage(prefix: string): Promise<number> {
    const dirPath = this.resolvePath(prefix);
    let totalSize = 0;

    try {
      await this.walkDirectory(dirPath, async (filePath) => {
        if (this.uploadingFiles.has(filePath)) {
          return;
        }
        try {
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
          }
        } catch {
          // Skip inaccessible files
        }
      });
    } catch {
      // Directory might not exist
    }

    return totalSize;
  }

  async close(): Promise<void> {
    // No resources to clean up for local storage
  }

  private resolvePath(key: string): string {
    // Sanitize key to prevent directory traversal
    const sanitized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.baseDir, sanitized);
  }

  private async streamToFile(
    stream: NodeJS.ReadableStream,
    filePath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);

      stream.pipe(writeStream);

      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      stream.on('error', reject);
    });
  }

  private async getFileSize(file: Buffer | NodeJS.ReadableStream): Promise<number> {
    // Buffers can be sized for free; streams can't without consuming them,
    // so stream uploads skip the pre-upload quota check (enforcement still
    // happens on the next upload / via enforceStorageQuota).
    return Buffer.isBuffer(file) ? file.length : 0;
  }

  private async walkDirectory(
    dir: string,
    callback: (filePath: string) => void | Promise<void>,
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, callback);
        } else {
          await callback(fullPath);
        }
      }
    } catch {
      // Directory might not exist or be inaccessible
    }
  }

  /**
   * Check available disk space
   */
  async checkDiskSpace(requiredBytes: number): Promise<boolean> {
    try {
      const availableSpace = this.getAvailableDiskSpace(this.baseDir);
      
      if (availableSpace < requiredBytes * 1.5) { // 1.5x safety margin
        console.log(`[LocalStorage] Insufficient disk space: ${availableSpace} available, ${requiredBytes * 1.5} required`);
        throw new Error(`Insufficient disk space: ${availableSpace} bytes available, ${requiredBytes} required`);
      }
      
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error;
      }
      console.error('[LocalStorage] Disk space check failed:', error);
      return true; // Conservative: assume enough space
    }
  }

  private getAvailableDiskSpace(dir: string): number {
    try {
      if (process.platform === 'win32') {
        return this.getWindowsDiskSpace(dir);
      } else {
        return this.getUnixDiskSpace(dir);
      }
    } catch (error) {
      console.error('[LocalStorage] Disk space calculation failed:', error);
      return 1024 * 1024 * 1024; // Conservative fallback: 1GB
    }
  }

  private getWindowsDiskSpace(dir: string): number {
    const stats = statfsSync(dir);
    const blockSize = (stats as any).bsize || 4096;
    const availableBlocks = (stats as any).bfree || stats.bavail || 0;
    return availableBlocks * blockSize;
  }

  private getUnixDiskSpace(dir: string): number {
    const stats = statfsSync(dir);
    const blockSize = (stats as any).bsize || 4096;
    const availableBlocks = (stats as any).bavail || stats.bfree || 0;
    return availableBlocks * blockSize;
  }

  /**
   * Mark a file as currently being uploaded (for quota calculations)
   */
  markFileUploading(key: string): void {
    const filePath = this.resolvePath(key);
    this.uploadingFiles.add(filePath);
  }

  /**
   * Mark a file upload as complete
   */
  markFileComplete(key: string): void {
    const filePath = this.resolvePath(key);
    this.uploadingFiles.delete(filePath);
  }
}
