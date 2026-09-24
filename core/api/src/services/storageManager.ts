import { promises as fs } from 'node:fs';
import { statfsSync } from 'node:fs';
import path from 'node:path';
import type { VideosRepo } from '../repositories/videos.js';

export interface StorageUsage {
  totalGB: number;
  usedGB: number;
  availableGB: number;
  files: number;
}

export class StorageManager {
  private uploadingFiles = new Set<string>();
  
  constructor(
    private storageDir: string,
    private videosRepo: VideosRepo,
    private maxGB: number = 10
  ) {}
  
  markFileUploading(filePath: string): void {
    this.uploadingFiles.add(filePath);
  }
  
  markFileComplete(filePath: string): void {
    this.uploadingFiles.delete(filePath);
  }
  
  async cleanupOrphanedFiles(): Promise<number> {
    try {
      const allFiles = await fs.readdir(this.storageDir);
      const dbFiles = this.videosRepo.list().map(v => v.file_path);
      
      const orphaned = allFiles.filter(f => 
        !dbFiles.includes(path.join(this.storageDir, f)) && 
        !this.uploadingFiles.has(path.join(this.storageDir, f))
      );
      
      for (const file of orphaned) {
        const filePath = path.join(this.storageDir, file);
        try {
          await fs.unlink(filePath);
          console.log(`[StorageManager] Deleted orphaned file: ${file}`);
        } catch (error) {
          console.error(`[StorageManager] Failed to delete ${file}:`, error);
        }
      }
      
      return orphaned.length;
    } catch (error) {
      console.error('[StorageManager] Cleanup failed:', error);
      return 0;
    }
  }
  
  async enforceStorageQuota(): Promise<void> {
    const usage = await this.getStorageUsage();
    
    if (usage.usedGB > this.maxGB) {
      console.log(`[StorageManager] Storage quota exceeded: ${usage.usedGB}GB / ${this.maxGB}GB`);
      
      // Clean up orphaned files first
      const cleaned = await this.cleanupOrphanedFiles();
      console.log(`[StorageManager] Cleaned ${cleaned} orphaned files`);
      
      // Recheck usage after cleanup
      const newUsage = await this.getStorageUsage();
      
      if (newUsage.usedGB > this.maxGB) {
        // Implement LRU cleanup if still over quota
        await this.cleanupLRU(this.maxGB);
      }
    }
  }
  
  async cleanupLRU(targetGB: number): Promise<void> {
    const videos = this.videosRepo.list();
    
    // Sort by creation time (oldest first)
    const sortedVideos = videos.sort((a, b) => a.created_at - b.created_at);
    
    let currentUsage = await this.getStorageUsage();
    
    for (const video of sortedVideos) {
      if (currentUsage.usedGB <= targetGB) break;
      
      try {
        // Check if video is currently being uploaded
        if (this.uploadingFiles.has(video.file_path)) {
          continue;
        }
        
        await fs.unlink(video.file_path);
        
        // Delete thumbnail if exists
        if (video.thumbnail_path) {
          await fs.unlink(video.thumbnail_path).catch(() => {});
        }
        
        // Remove from database
        this.videosRepo.delete(video.id);
        
        console.log(`[StorageManager] Deleted old video: ${video.id}`);
        
        currentUsage = await this.getStorageUsage();
      } catch (error) {
        console.error(`[StorageManager] Failed to delete video ${video.id}:`, error);
      }
    }
  }
  
  async checkDiskSpace(requiredBytes: number): Promise<boolean> {
    try {
      const availableSpace = await this.getAvailableDiskSpace(this.storageDir);
      
      if (availableSpace < requiredBytes * 1.5) { // 1.5x safety margin
        console.log(`[StorageManager] Insufficient disk space: ${availableSpace} available, ${requiredBytes * 1.5} required`);
        
        // Try cleanup first
        await this.cleanupOrphanedFiles();
        
        const availableAfter = await this.getAvailableDiskSpace(this.storageDir);
        
        if (availableAfter < requiredBytes) {
          throw new Error(`Insufficient disk space: ${availableAfter} bytes available, ${requiredBytes} required`);
        }
      }
      
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error;
      }
      console.error('[StorageManager] Disk space check failed:', error);
      // Conservative: assume enough space
      return true;
    }
  }
  
  async getStorageUsage(): Promise<StorageUsage> {
    try {
      const files = await fs.readdir(this.storageDir);
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(this.storageDir, file);
        try {
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
          }
        } catch (error) {
          // Skip files that can't be accessed
        }
      }
      
      const usedGB = totalSize / (1024 * 1024 * 1024);
      const availableGB = Math.max(0, this.maxGB - usedGB);
      
      return {
        totalGB: this.maxGB,
        usedGB,
        availableGB,
        files: files.length
      };
    } catch (error) {
      console.error('[StorageManager] Failed to get storage usage:', error);
      return {
        totalGB: this.maxGB,
        usedGB: 0,
        availableGB: this.maxGB,
        files: 0
      };
    }
  }
  
  private async getAvailableDiskSpace(dir: string): Promise<number> {
    try {
      if (process.platform === 'win32') {
        return this.getWindowsDiskSpace(dir);
      } else {
        return this.getUnixDiskSpace(dir);
      }
    } catch (error) {
      console.error('[StorageManager] Disk space calculation failed:', error);
      // Conservative fallback: assume 1GB available
      return 1024 * 1024 * 1024;
    }
  }
  
  private getWindowsDiskSpace(dir: string): number {
    const stats = statfsSync(dir);
    // Use bsize for block size and bfree for available blocks
    const blockSize = (stats as any).bsize || 4096;
    const availableBlocks = (stats as any).bfree || stats.bavail || 0;
    return availableBlocks * blockSize;
  }
  
  private getUnixDiskSpace(dir: string): number {
    const stats = statfsSync(dir);
    // Use bsize for block size and bavail for available blocks
    const blockSize = (stats as any).bsize || 4096;
    const availableBlocks = (stats as any).bavail || stats.bfree || 0;
    return availableBlocks * blockSize;
  }
}