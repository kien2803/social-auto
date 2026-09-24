# Storage Management Guide

## Overview

Social-auto manages video storage with automatic cleanup, quota enforcement, and disk space monitoring. This guide covers the storage architecture, configuration, and operational procedures.

## Architecture

### Storage Components

1. **Storage Manager** (`core/api/src/services/storageManager.ts`)
   - Automatic orphaned file cleanup
   - Disk space monitoring
   - Storage quota enforcement
   - LRU cache management

2. **Storage Directory Structure**
   ```
   storage/
   ├── app.db              # SQLite database
   ├── backups/            # Database backups
   ├── <sha256>.mp4        # Video files
   ├── <sha256>.jpg        # Thumbnail files
   └── upload-*.tmp        # Temporary upload files
   ```

3. **Database Integration**
   - `videos` table tracks file paths
   - SHA256 deduplication prevents duplicates
   - Foreign key relationships prevent orphaned references

## Implementation Details

### 1. Storage Manager Class

```typescript
// core/api/src/services/storageManager.ts
export class StorageManager {
  private uploadingFiles = new Set<string>();
  
  constructor(
    private storageDir: string,
    private videosRepo: VideosRepo,
    private maxGB: number = 10
  ) {}
  
  // Track files currently being uploaded
  markFileUploading(filePath: string): void {
    this.uploadingFiles.add(filePath);
  }
  
  markFileComplete(filePath: string): void {
    this.uploadingFiles.delete(filePath);
  }
  
  // Clean up orphaned files
  async cleanupOrphanedFiles(): Promise<number> {
    const allFiles = await fs.readdir(this.storageDir);
    const dbFiles = this.videosRepo.list().map(v => path.basename(v.file_path));
    
    const orphaned = allFiles.filter(f => 
      !dbFiles.includes(f) && 
      !this.uploadingFiles.has(f) &&
      !f.endsWith('.db') // Don't delete database
    );
    
    for (const file of orphaned) {
      await fs.unlink(path.join(this.storageDir, file));
    }
    
    return orphaned.length;
  }
  
  // Enforce storage quota
  async enforceStorageQuota(): Promise<void> {
    const usage = await this.getStorageUsage();
    if (usage.usedGB > this.maxGB) {
      await this.cleanupLRU(this.maxGB);
    }
  }
  
  // Check disk space before upload
  async checkDiskSpace(requiredBytes: number): Promise<boolean> {
    const stats = fs.statfsSync(this.storageDir);
    const availableSpace = stats.available * stats.blksize;
    
    if (availableSpace < requiredBytes * 1.5) { // 1.5x safety margin
      await this.cleanupOrphanedFiles();
      
      const statsAfter = fs.statfsSync(this.storageDir);
      const availableAfter = statsAfter.available * statsAfter.blksize;
      
      if (availableAfter < requiredBytes) {
        throw new UploadError(507, 'Insufficient disk space');
      }
    }
    
    return true;
  }
  
  // Get current storage usage
  async getStorageUsage(): Promise<StorageUsage> {
    const files = await fs.readdir(this.storageDir);
    let totalSize = 0;
    
    for (const file of files) {
      const filePath = path.join(this.storageDir, file);
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        totalSize += stats.size;
      }
    }
    
    const diskStats = fs.statfsSync(this.storageDir);
    const availableGB = (diskStats.available * diskStats.blksize) / (1024 ** 3);
    
    return {
      totalGB: availableGB + (totalSize / (1024 ** 3)),
      usedGB: totalSize / (1024 ** 3),
      availableGB,
      files: files.length,
    };
  }
  
  // LRU cleanup when quota exceeded
  private async cleanupLRU(targetGB: number): Promise<void> {
    const videos = this.videosRepo.list()
      .sort((a, b) => a.created_at - b.created_at); // Oldest first
    
    let currentUsage = await this.getStorageUsage();
    
    for (const video of videos) {
      if (currentUsage.usedGB <= targetGB) break;
      
      await fs.unlink(video.file_path);
      if (video.thumbnail_path) {
        await fs.unlink(video.thumbnail_path).catch(() => {});
      }
      
      this.videosRepo.delete(video.id);
      currentUsage = await this.getStorageUsage();
    }
  }
}
```

### 2. API Integration

**Storage Routes:**
```typescript
// core/api/src/routes/storage.ts
export function registerStorageRoutes(app: FastifyInstance, deps: { storageManager: StorageManager }): void {
  // Get current storage usage
  app.get('/storage/usage', async () => {
    const usage = await deps.storageManager.getStorageUsage();
    return usage;
  });
  
  // Trigger manual cleanup
  app.post('/storage/cleanup', async () => {
    const cleaned = await deps.storageManager.cleanupOrphanedFiles();
    return { success: true, cleaned };
  });
  
  // Enforce storage quota
  app.post('/storage/enforce-quota', async () => {
    await deps.storageManager.enforceStorageQuota();
    const usage = await deps.storageManager.getStorageUsage();
    return { success: true, usage };
  });
}
```

**Upload Integration:**
```typescript
// core/api/src/services/videoService.ts
export async function ingestUpload(
  repo: VideosRepo,
  storageDir: string,
  iter: AsyncIterable<Buffer>,
  mime: string,
  originalFilename: string,
  onProgress?: (bytes: number) => void,
  storageManager?: StorageManager,
): Promise<IngestResult> {
  // Check disk space before upload
  if (storageManager) {
    const estimatedSize = MAX_SIZE_BYTES * 2;
    try {
      await storageManager.checkDiskSpace(estimatedSize);
    } catch (error) {
      if (error instanceof Error) {
        throw new UploadError(507, error.message);
      }
      throw new UploadError(507, 'Disk space check failed');
    }
  }
  
  // Mark file as uploading
  if (storageManager) {
    storageManager.markFileUploading(tmpPath);
  }
  
  try {
    // ... upload logic ...
  } catch (err) {
    if (storageManager) {
      storageManager.markFileComplete(tmpPath);
    }
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
  
  // Mark file as complete
  if (storageManager) {
    storageManager.markFileComplete(tmpPath);
    storageManager.markFileUploading(finalPath);
  }
  
  // ... rest of logic ...
  
  // Mark as complete after successful insertion
  if (storageManager) {
    storageManager.markFileComplete(finalPath);
  }
}
```

### 3. Automatic Cleanup

**Periodic Cleanup (API):**
```typescript
// core/api/src/server.ts
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const cleanupInterval = setInterval(async () => {
  try {
    const cleaned = await storageManager.cleanupOrphanedFiles();
    if (cleaned > 0) {
      app.log.info(`[StorageManager] Periodic cleanup: ${cleaned} orphaned files removed`);
    }
    await storageManager.enforceStorageQuota();
  } catch (err) {
    // Ignore error in periodic cleanup to prevent crashes
  }
}, CLEANUP_INTERVAL_MS);

// Perform initial cleanup immediately
void (async () => {
  try {
    const cleaned = await storageManager.cleanupOrphanedFiles();
    if (cleaned > 0) {
      app.log.info(`[StorageManager] Cleaned ${cleaned} orphaned files on startup`);
    }
    await storageManager.enforceStorageQuota();
    app.log.info('[StorageManager] Storage quota enforced on startup');
  } catch (err) {
    // Ignore error in startup cleanup to prevent crashes
  }
})();

// Cleanup interval on app close
app.addHook('onClose', () => {
  clearInterval(cleanupInterval);
});
```

## Configuration

### Environment Variables

```bash
# Storage Configuration
STORAGE_DIR=./storage              # Storage directory path
STORAGE_QUOTA_GB=10                # Maximum storage in GB
MAX_VIDEO_SIZE_GB=2               # Maximum video file size in GB
```

### PM2 Configuration

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      script: 'core/api/src/server.ts',
      env: {
        STORAGE_DIR: './storage',
        STORAGE_QUOTA_GB: '10',
      },
    },
  ],
};
```

## Storage Policies

### 1. File Naming Convention

- **Video files:** `<sha256>.<ext>` (e.g., `a1b2c3d4.mp4`)
- **Thumbnail files:** `<sha256>.jpg` (e.g., `a1b2c3d4.jpg`)
- **Temporary files:** `upload-<timestamp>-<random>.tmp`
- **Database files:** `app.db`

### 2. Deduplication Strategy

- SHA256 hash computed during upload
- Duplicate files share storage
- Database references same file_path
- Prevents storage waste

### 3. Cleanup Triggers

1. **Automatic (API):** Every 6 hours
2. **Startup (API):** On application start
3. **Manual:** Via `/storage/cleanup` endpoint
4. **Pre-upload:** When disk space insufficient
5. **Quota exceeded:** When storage > quota limit

### 4. LRU Eviction Policy

- Oldest files deleted first
- Based on `created_at` timestamp
- Only deletes when quota exceeded
- Preserves recently uploaded files

## Monitoring

### Storage Usage Endpoint

```bash
curl http://localhost:3000/storage/usage
```

Response:
```json
{
  "totalGB": 15.5,
  "usedGB": 8.2,
  "availableGB": 7.3,
  "files": 42
}
```

### Storage Cleanup Endpoint

```bash
# Trigger manual cleanup
curl -X POST http://localhost:3000/storage/cleanup
```

Response:
```json
{
  "success": true,
  "cleaned": 3
}
```

### Storage Quota Enforcement

```bash
# Enforce storage quota
curl -X POST http://localhost:3000/storage/enforce-quota
```

Response:
```json
{
  "success": true,
  "usage": {
    "totalGB": 15.5,
    "usedGB": 8.2,
    "availableGB": 7.3,
    "files": 42
  }
}
```

## Troubleshooting

### Common Issues

**1. Disk Space Full**
- **Symptom:** Upload fails with 507 error
- **Solution:** Manual cleanup or increase storage quota
- **Check:** `/storage/usage` endpoint

**2. Orphaned Files Accumulate**
- **Symptom:** Storage usage high but few videos in database
- **Solution:** Trigger manual cleanup
- **Check:** `/storage/cleanup` endpoint

**3. Cleanup Deletes Active Files**
- **Symptom:** Uploads fail during cleanup
- **Solution:** File tracking prevents deletion of uploading files
- **Check:** Worker logs for cleanup activity

**4. Quota Enforcement Too Aggressive**
- **Symptom:** Recent files deleted unexpectedly
- **Solution:** Increase `STORAGE_QUOTA_GB` or disable enforcement
- **Check:** Storage manager configuration

### Debug Mode

Enable detailed storage logging:
```bash
LOG_LEVEL=debug pnpm core:dev:api
```

Monitor storage operations:
```bash
# Watch storage directory
watch -n 1 'ls -lh storage/'

# Monitor storage usage
curl -s http://localhost:3000/storage/usage | jq
```

## Best Practices

### 1. Storage Planning

- **Quota Calculation:** Estimate based on expected video count × average file size
- **Disk Space:** Maintain 2× quota as available disk space
- **Backup Storage:** Separate storage for database backups

### 2. File Management

- **Regular Cleanup:** Schedule periodic cleanup (already implemented)
- **Monitor Usage:** Check storage usage weekly
- **Archive Old Files:** Move old files to cold storage if needed

### 3. Performance Optimization

- **Streaming Upload:** Avoid loading entire file into memory
- **Concurrent Uploads:** Limit to prevent disk I/O saturation
- **Cleanup Timing:** Run cleanup during low-traffic periods

### 4. Security Considerations

- **File Validation:** Use magic number detection (already implemented)
- **Path Traversal:** Validate file paths before operations
- **Access Control:** Restrict storage directory permissions

## Testing

### Unit Tests

```bash
# Test storage manager
pnpm test core/api/src/services/storageManager.test.ts

# Test storage routes
pnpm test core/api/src/routes/storage.test.ts
```

### Integration Tests

```bash
# Test upload with storage manager
pnpm test core/api/src/routes/videos.test.ts

# Test cleanup functionality
pnpm test core/api/src/services/videoService.test.ts
```

### Manual Testing

1. **Upload Test:**
   - Upload video near quota limit
   - Verify quota enforcement triggers
   - Check LRU eviction works

2. **Cleanup Test:**
   - Create orphaned files manually
   - Trigger manual cleanup
   - Verify files deleted

3. **Disk Space Test:**
   - Fill disk to near capacity
   - Attempt upload
   - Verify proper error handling

## Migration

### Moving Storage Directory

1. **Stop services:**
   ```bash
   pm2 stop social-auto-api social-auto-worker
   ```

2. **Move files:**
   ```bash
   mv storage /new/path/storage
   ```

3. **Update configuration:**
   ```bash
   # Update .env.local
   STORAGE_DIR=/new/path/storage
   ```

4. **Restart services:**
   ```bash
   pm2 restart social-auto-api social-auto-worker
   ```

### Increasing Storage Quota

1. **Update environment variable:**
   ```bash
   STORAGE_QUOTA_GB=20
   ```

2. **Restart API:**
   ```bash
   pm2 restart social-auto-api
   ```

3. **Verify new quota:**
   ```bash
   curl http://localhost:3000/storage/usage
   ```

## References

- **Storage Manager Implementation:** `core/api/src/services/storageManager.ts`
- **Storage Routes:** `core/api/src/routes/storage.ts`
- **Video Service:** `core/api/src/services/videoService.ts`
- **Database Schema:** `core/packages/shared/src/db/schema.ts`