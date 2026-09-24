# Phase 1: Core Functionality - Bug Fixes & Troubleshooting

**Purpose:** Document bugs discovered during Phase 1 implementation and their solutions  
**Status:** Living document - updated as bugs are discovered and fixed

---

## Current Codebase Analysis

### Existing Working Components (No bugs found)
- ✅ Video upload endpoint with streaming (core/api/src/routes/videos.ts)
- ✅ Thumbnail generation with ffmpeg (core/api/src/services/videoService.ts)
- ✅ Worker scheduling logic (core/worker/src/index.ts)
- ✅ Token refresh logic (core/worker/src/index.ts)
- ✅ Error classification basic (core/worker/src/index.ts)
- ✅ Database schema complete (core/packages/shared/src/db/schema.ts)

### Identified Gaps (Not bugs, but missing features)
- ❌ Real YouTube upload integration (currently stub only)
- ❌ Streaming upload to YouTube (currently loads entire file)
- ❌ Real-time progress tracking (missing WebSocket/SSE)
- ❌ Magic number file detection (uses MIME only)
- ❌ Storage cleanup strategy (missing)
- ❌ Enhanced quota management (incomplete)

---

## Anticipated Bugs & Prevention for New Features

### YouTube Integration Issues

#### Bug 1.1: YouTube API Client Authentication
**Scenario:** Google API client fails to authenticate with OAuth tokens  
**Symptoms:** 401 errors during YouTube upload attempts  
**Root Cause:** Token format incompatibility or expired tokens  
**Prevention:** Test authentication before upload, validate token format

```typescript
// core/worker/src/publishers/youtube.ts
async validateAuthentication(accessToken: string): Promise<boolean> {
  try {
    await youtubeClient.channels.list({
      part: 'snippet',
      mine: true
    }, { accessToken });
    return true;
  } catch (error) {
    console.error('Authentication validation failed:', error);
    return false;
  }
}
```

#### Bug 1.2: Resumable Upload Session Management
**Scenario:** Upload session expires or gets lost during large file uploads  
**Symptoms:** Uploads fail partway through, cannot resume  
**Root Cause:** Session timeout or incorrect session ID handling  
**Prevention:** Implement session persistence and timeout handling

```typescript
// core/worker/src/publishers/youtubeStreaming.ts
class UploadSessionManager {
  private sessions = new Map<string, UploadSession>();
  
  createSession(videoId: string): UploadSession {
    const session = new UploadSession(videoId);
    this.sessions.set(videoId, session);
    return session;
  }
  
  getSession(videoId: string): UploadSession | undefined {
    return this.sessions.get(videoId);
  }
  
  cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > 3600000) { // 1 hour timeout
        this.sessions.delete(id);
      }
    }
  }
}
```

#### Bug 1.3: YouTube API Quota Calculation Errors
**Scenario:** Quota tracking doesn't match actual YouTube API usage  
**Symptoms:** Uploads blocked unexpectedly or quota exceeded prematurely  
**Root Cause:** Incorrect quota cost calculation or timing issues  
**Prevention:** Verify quota costs with YouTube documentation, test with real uploads

```typescript
// core/worker/src/services/quotaManager.ts
const YOUTUBE_QUOTA_COSTS = {
  'videos.insert': 1600,
  'videos.list': 1,
  'channels.list': 1,
  // Verify these costs with YouTube API documentation
};

export function getQuotaCost(operation: string): number {
  const cost = YOUTUBE_QUOTA_COSTS[operation];
  if (cost === undefined) {
    console.warn(`Unknown quota cost for operation: ${operation}`);
    return 0; // Conservative default
  }
  return cost;
}
```

---

### File Validation Issues

#### Bug 2.1: Magic Number Library Compatibility
**Scenario:** file-type library fails to detect certain video formats  
**Symptoms:** Valid video files rejected as invalid format  
**Root Cause:** Library doesn't support specific video codecs or containers  
**Prevention:** Test with various video formats, provide fallback validation

```typescript
// core/api/src/services/fileTypeDetector.ts
export async function detectRealFileType(filePath: string): Promise<string> {
  try {
    const buffer = fs.readFileSync(filePath, { start: 0, end: 4100 });
    const type = await fileTypeFromBuffer(buffer);
    
    if (type && ['mp4', 'mov', 'webm'].includes(type.ext)) {
      return type.ext;
    }
  } catch (error) {
    console.warn('Magic number detection failed, falling back to MIME:', error);
  }
  
  // Fallback to MIME type detection
  return detectFileTypeByMIME(filePath);
}
```

#### Bug 2.2: Duration Detection Failure
**Scenario:** ffprobe fails to detect video duration  
**Symptoms:** Duration validation skipped or errors  
**Root Cause:** ffprobe not installed or video file corrupted  
**Prevention:** Graceful fallback, clear error messages

```typescript
// core/api/src/services/videoService.ts (enhanced)
async function probeDuration(filePath: string): Promise<number | null> {
  try {
    // Check if ffprobe is available
    await checkCommandAvailable('ffprobe');
    
    const duration = await probeDurationWithFFProbe(filePath);
    return duration;
  } catch (error) {
    console.warn('Duration detection failed, video will be accepted without duration check:', error);
    return null; // Allow upload without duration validation
  }
}

async function checkCommandAvailable(command: string): Promise<void> {
  try {
    await exec(`which ${command}`);
  } catch {
    throw new Error(`${command} is not installed. Please install ffmpeg/ffprobe.`);
  }
}
```

---

### Storage Management Issues

#### Bug 3.1: Storage Cleanup Race Conditions
**Scenario:** Cleanup deletes files that are currently being uploaded  
**Symptoms:** Upload fails partway through, file disappears  
**Root Cause:** Cleanup runs while upload is in progress  
**Prevention:** Implement file locking or check file usage before deletion

```typescript
// core/api/src/services/storageManager.ts
export class StorageManager {
  private uploadingFiles = new Set<string>();
  
  markFileUploading(filePath: string): void {
    this.uploadingFiles.add(filePath);
  }
  
  markFileComplete(filePath: string): void {
    this.uploadingFiles.delete(filePath);
  }
  
  async cleanupOrphanedFiles(): Promise<number> {
    const allFiles = await fs.readdir(this.storageDir);
    const dbFiles = this.videosRepo.list().map(v => v.file_path);
    
    const orphaned = allFiles.filter(f => 
      !dbFiles.includes(f) && !this.uploadingFiles.has(f)
    );
    
    for (const file of orphaned) {
      await fs.unlink(path.join(this.storageDir, file));
    }
    
    return orphaned.length;
  }
}
```

#### Bug 3.2: Disk Space Calculation Cross-Platform Issues
**Scenario:** Disk space calculation fails on different operating systems  
**Symptoms:** Incorrect disk space readings, uploads blocked incorrectly  
**Root Cause:** fs.statfsSync behavior differences between platforms  
**Prevention:** Test on multiple platforms, use cross-platform alternatives

```typescript
// core/api/src/services/storageManager.ts
export async function getAvailableDiskSpace(dir: string): Promise<number> {
  try {
    if (process.platform === 'win32') {
      return await getWindowsDiskSpace(dir);
    } else {
      return await getUnixDiskSpace(dir);
    }
  } catch (error) {
    console.error('Disk space calculation failed:', error);
    // Conservative fallback: assume 1GB available
    return 1024 * 1024 * 1024;
  }
}

async function getWindowsDiskSpace(dir: string): Promise<number> {
  // Windows-specific implementation
  const stats = fs.statfsSync(dir);
  return stats.available * stats.blksize;
}

async function getUnixDiskSpace(dir: string): Promise<number> {
  // Unix-specific implementation
  const stats = fs.statfsSync(dir);
  return stats.available * stats.blksize;
}
```

---

### Progress Tracking Issues

#### Bug 4.1: WebSocket Connection Drops
**Scenario:** Progress updates stop when WebSocket connection drops  
**Symptoms:** User sees incomplete progress information  
**Root Cause:** Network issues or browser tab inactivity  
**Prevention:** Implement reconnection logic and progress caching

```typescript
// core/api/src/routes/uploadProgress.ts
export class ProgressTracker {
  private progressCache = new Map<string, UploadProgress>();
  
  updateProgress(videoId: string, progress: number): void {
    this.progressCache.set(videoId, {
      videoId,
      progress,
      timestamp: Date.now()
    });
  }
  
  getProgress(videoId: string): UploadProgress | undefined {
    return this.progressCache.get(videoId);
  }
  
  cleanupOldProgress(): void {
    const now = Date.now();
    for (const [id, progress] of this.progressCache) {
      if (now - progress.timestamp > 3600000) { // 1 hour old
        this.progressCache.delete(id);
      }
    }
  }
}
```

#### Bug 4.2: Progress Reporting Inaccuracy
**Scenario:** Progress percentage jumps or reports incorrectly  
**Symptoms:** Progress shows 0% then 100%, or goes backwards  
**Root Cause:** Incorrect progress calculation from YouTube API  
**Prevention:** Validate progress values, implement smoothing

```typescript
// core/worker/src/publishers/youtube.ts
class ProgressReporter {
  private lastProgress = 0;
  
  reportProgress(videoId: string, rawProgress: number): void {
    // Validate progress is between 0-100
    const validatedProgress = Math.max(0, Math.min(100, rawProgress));
    
    // Ensure progress is monotonically increasing
    if (validatedProgress >= this.lastProgress) {
      this.lastProgress = validatedProgress;
      this.sendProgress(videoId, validatedProgress);
    } else {
      console.warn(`Progress went backwards: ${this.lastProgress}% -> ${validatedProgress}%`);
    }
  }
}
```

---

## Monitoring & Debugging Tools

### YouTube API Health Check

```typescript
// core/api/src/routes/health.ts
async function checkYouTubeAPIHealth(): Promise<HealthCheck> {
  try {
    const response = await youtubeClient.videos.list({
      part: 'snippet',
      mine: true,
      maxResults: 1
    });
    
    return {
      status: 'ok',
      message: 'YouTube API accessible'
    };
  } catch (error) {
    return {
      status: 'error',
      message: `YouTube API error: ${error.message}`
    };
  }
}
```

### Storage Usage Monitoring

```typescript
// core/api/src/routes/storage.ts
app.get('/storage/usage', async () => {
  const manager = new StorageManager();
  const usage = await manager.getStorageUsage();
  
  return {
    totalGB: usage.totalGB,
    usedGB: usage.usedGB,
    availableGB: usage.availableGB,
    usagePercentage: (usage.usedGB / usage.totalGB) * 100,
    fileCount: usage.files
  };
});
```

---

## Bug Prevention Checklist

### Before YouTube Integration
- [ ] Verify Google API client library compatibility
- [ ] Test authentication with real YouTube account
- [ ] Validate quota costs with YouTube documentation
- [ ] Set up test YouTube account with limited quota

### During YouTube Integration
- [ ] Implement proper error handling for API responses
- [ ] Add logging for all YouTube API calls
- [ ] Test with various file sizes (small, medium, large)
- [ ] Implement resumable upload for large files

### After YouTube Integration
- [ ] Test real uploads to YouTube
- [ ] Verify quota tracking accuracy
- [ ] Test network interruption scenarios
- [ ] Monitor memory usage during large file uploads

---

## Emergency Procedures

### YouTube Upload Failures
1. Check YouTube API status: https://status.cloud.google.com/
2. Verify authentication tokens are valid
3. Check quota usage: GET /api/quota/youtube
4. Review YouTube API error logs
5. Test with small file to isolate issue

### Storage Issues
1. Check disk space: GET /api/storage/usage
2. Review storage cleanup logs
3. Manually cleanup orphaned files if needed
4. Check file permissions on storage directory

### Progress Tracking Issues
1. Check WebSocket connection status
2. Review progress cache for stale data
3. Test progress updates with small upload
4. Monitor browser console for connection errors

---

**Bug Fix Document Status:** Active  
**Last Updated:** 2025-09-13  
**Next Review:** After Phase 1 YouTube integration complete