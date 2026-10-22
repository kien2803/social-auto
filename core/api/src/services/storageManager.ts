import type { VideosRepo } from '../repositories/videos.js';

export interface StorageBackend {
  type: 'local' | 's3' | 'r2';
  initialize(): Promise<void>;
  getUsage(path: string): Promise<number>;
  list(path: string, limit: number): Promise<Array<{ key: string; isDirectory: boolean }>>;
  get(key: string): Promise<Buffer>;
  put(key: string, data: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StorageUsage {
  totalGB: number;
  usedGB: number;
  availableGB: number;
  files: number;
}

export class StorageManager {
  private uploadingFiles = new Set<string>();
  
  constructor(
    private storage: StorageBackend,
    private videosRepo: VideosRepo,
    private maxGB: number = 10
  ) {}
  
  markFileUploading(key: string): void {
    this.uploadingFiles.add(key);
    
    // For local storage, also mark in the backend
    if (this.storage.type === 'local') {
      (this.storage as any).markFileUploading?.(key);
    }
  }
  
  markFileComplete(key: string): void {
    this.uploadingFiles.delete(key);
    
    // For local storage, also mark in the backend
    if (this.storage.type === 'local') {
      (this.storage as any).markFileComplete?.(key);
    }
  }
  
  async cleanupOrphanedFiles(): Promise<number> {
    try {
      const allItems = await this.storage.list('', 1000);
      const dbFiles = this.videosRepo.list().map(v => this.extractKey(v.file_path));
      
      const orphaned = allItems.filter(item => 
        !dbFiles.includes(item.key) && 
        !this.uploadingFiles.has(item.key) &&
        !item.isDirectory
      );
      
      for (const item of orphaned) {
        try {
          await this.storage.delete(item.key);
          console.log(`[StorageManager] Deleted orphaned file: ${item.key}`);
        } catch (error) {
          console.error(`[StorageManager] Failed to delete ${item.key}:`, error);
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
        const key = this.extractKey(video.file_path);
        if (this.uploadingFiles.has(key)) {
          continue;
        }
        
        await this.storage.delete(key);
        
        // Delete thumbnail if exists
        if (video.thumbnail_path) {
          const thumbKey = this.extractKey(video.thumbnail_path);
          await this.storage.delete(thumbKey).catch(() => {});
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
    // For S3/R2, disk space is not a concern
    if (this.storage.type !== 'local') {
      return true;
    }
    
    try {
      const availableSpace = await (this.storage as any).checkDiskSpace?.(requiredBytes) ?? true;
      return availableSpace;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error;
      }
      console.error('[StorageManager] Disk space check failed:', error);
      return true; // Conservative: assume enough space
    }
  }
  
  async getStorageUsage(): Promise<StorageUsage> {
    try {
      const totalBytes = await this.storage.getUsage('');
      const usedGB = totalBytes / (1024 * 1024 * 1024);
      const availableGB = Math.max(0, this.maxGB - usedGB);
      
      const items = await this.storage.list('', 1000);
      const files = items.filter(i => !i.isDirectory).length;
      
      return {
        totalGB: this.maxGB,
        usedGB,
        availableGB,
        files
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
  
  /**
   * Extract storage key from file path
   * For local storage, this removes the base directory prefix
   * For S3/R2, this returns the key as-is
   */
  private extractKey(filePath: string): string {
    if (this.storage.type === 'local') {
      // Remove base directory prefix
      const baseDir = (this.storage as any).baseDir || '';
      if (filePath.startsWith(baseDir)) {
        return filePath.slice(baseDir.length).replace(/^[/\\]/, '');
      }
    }
    return filePath;
  }
}