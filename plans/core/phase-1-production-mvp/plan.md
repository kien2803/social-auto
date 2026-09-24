# Phase 1: Core Functionality - Detailed Plan

**Outcome:** Complete real YouTube upload integration with production-ready error handling, quota management, and storage cleanup.

**Timeline:** 1-2 weeks (reduced from 2-3 weeks based on existing codebase)  
**Priority:** Critical (must complete before production deployment)

**Current State Analysis:**
- ✅ Video upload endpoint exists with streaming, SHA256, deduplication
- ✅ Thumbnail generation with ffmpeg implemented
- ✅ Worker scheduling logic fully functional
- ✅ Token refresh logic implemented
- ✅ Error classification basic implementation
- ✅ Database schema complete
- ❌ Real YouTube upload (currently stub only)
- ❌ Quota management logic incomplete
- ❌ Real-time progress tracking missing
- ❌ Storage cleanup strategy missing
- ❌ File magic number detection missing
- ❌ Streaming upload to YouTube missing

---

## Sub-Phase 1.1: Real YouTube Upload Integration (Week 1, Days 1-3)

### Goal
Replace stub YouTube upload with real Google API integration using streaming upload.

### Tasks

#### 1.1.1 YouTube API Client Implementation
- **Deliverable:** Real YouTube Data API v3 upload client with resumable upload support
- **Owner:** Backend agent
- **Depends-on:** Existing OAuth implementation
- **Size:** L (2 days)
- **Acceptance:**
  - Uploads video to YouTube using authenticated user's account
  - Implements resumable upload protocol for large files
  - Handles YouTube API quota limits (10,000 units/day)
  - Supports video metadata (title, description, tags, privacy status)
  - Returns YouTube video ID and URL
  - Handles upload cancellation

**Implementation approach:**
```typescript
// core/worker/src/publishers/youtube.ts
async upload(video: Video, account: Account): Promise<UploadResult> {
  const accessToken = await getValidAccessToken(account);
  
  // Initialize resumable upload session
  const session = await youtubeClient.videos.insert({
    part: 'snippet,status',
    resource: {
      snippet: {
        title: video.title,
        description: video.description,
        tags: video.tags
      },
      status: {
        privacyStatus: video.visibility
      }
    }
  }, {
    // Use resumable upload for files > 10MB
    uploadType: 'resumable'
  });
  
  // Upload with streaming
  const uploadStream = fs.createReadStream(video.path);
  await uploadMedia(session, uploadStream, {
    onUploadProgress: (progress) => {
      this.updateProgress(video.id, progress);
    }
  });
  
  return { youtubeId: session.data.id };
}
```

#### 1.1.2 Streaming Upload to YouTube
- **Deliverable:** Streaming upload implementation to avoid loading entire file into memory
- **Owner:** Backend agent
- **Depends-on:** 1.1.1
- **Size:** M (1 day)
- **Acceptance:**
  - Streams video file directly to YouTube API
  - Supports chunked upload for large files
  - Handles network interruptions gracefully
  - Memory usage remains stable during upload
  - Supports upload resumption after interruption

**Implementation approach:**
```typescript
// core/worker/src/publishers/youtubeStreaming.ts
async uploadWithStream(videoPath: string, session: UploadSession): Promise<void> {
  const fileStream = fs.createReadStream(videoPath, { highWaterMark: 1024 * 1024 });
  const chunkSize = 8 * 1024 * 1024; // 8MB chunks
  
  for await (const chunk of fileStream) {
    await session.uploadChunk(chunk);
    // Progress tracking handled by session
  }
}
```

#### 1.1.3 Real-Time Progress Tracking
- **Deliverable:** WebSocket or SSE-based progress updates for YouTube upload
- **Owner:** Backend agent
- **Depends-on:** 1.1.1
- **Size:** M (1 day)
- **Acceptance:**
  - Provides real-time upload progress (0-100%)
  - Updates UI via WebSocket or Server-Sent Events
  - Shows current upload speed and ETA
  - Handles connection drops gracefully
  - Supports multiple concurrent uploads

**Implementation approach:**
```typescript
// core/api/src/routes/uploadProgress.ts
app.get('/videos/:id/progress', async (req, reply) => {
  const progress = await getUploadProgress(req.params.id);
  return reply.sse({ data: JSON.stringify(progress) });
});
```

### Risks
- **YouTube API changes:** API deprecation → implement version checking and fallback
- **Large file memory:** Streaming implementation still loads chunks → implement proper streaming
- **Network instability:** Upload interruptions → implement resumable upload

### Out of Scope
- YouTube live streaming (defer to later phases)
- YouTube analytics (defer to Phase 2)
- Video transcoding (use direct upload)

---

## Sub-Phase 1.2: Enhanced File Validation (Week 1, Days 4-5)

### Goal
Improve file validation to use magic number detection instead of MIME type only.

### Tasks

#### 1.2.1 Magic Number File Detection
- **Deliverable:** File type detection using magic numbers instead of extension/MIME only
- **Owner:** Backend agent
- **Depends-on:** Existing videoService.ts
- **Size:** S (0.5 day)
- **Acceptance:**
  - Detects real file format using magic numbers
  - Rejects files with spoofed extensions
  - Validates video format integrity
  - Returns clear error messages for format mismatches

**Implementation approach:**
```typescript
// core/api/src/services/fileTypeDetector.ts
import { fileTypeFromBuffer } from 'file-type';

export async function detectRealFileType(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath, { start: 0, end: 4100 });
  const type = await fileTypeFromBuffer(buffer);
  
  if (!type || !['mp4', 'mov', 'webm'].includes(type.ext)) {
    throw new Error('Invalid video format based on file signature');
  }
  
  return type.ext;
}
```

#### 1.2.2 Video Duration Validation
- **Deliverable:** Enhanced duration validation with YouTube limits
- **Owner:** Backend agent
- **Depends-on:** 1.2.1
- **Size:** S (0.5 day)
- **Acceptance:**
  - Validates video duration against YouTube limits (12 hours max, 15 minutes recommended)
  - Provides clear feedback for duration violations
  - Handles duration detection failures gracefully
  - Returns duration in both seconds and human-readable format

**Implementation approach:**
```typescript
// core/api/src/services/videoService.ts (enhanced)
const YOUTUBE_MAX_DURATION_SEC = 12 * 60 * 60; // 12 hours
const YOUTUBE_RECOMMENDED_DURATION_SEC = 15 * 60; // 15 minutes

function validateDuration(durationSec: number | null): void {
  if (durationSec === null) {
    console.warn('Could not determine video duration');
    return;
  }
  
  if (durationSec > YOUTUBE_MAX_DURATION_SEC) {
    throw new UploadError(400, 
      `Video duration ${formatDuration(durationSec)} exceeds YouTube maximum of 12 hours`);
  }
  
  if (durationSec > YOUTUBE_RECOMMENDED_DURATION_SEC) {
    console.warn(`Video duration ${formatDuration(durationSec)} exceeds YouTube recommended 15 minutes`);
  }
}
```

### Risks
- **Magic number detection library dependency:** Additional npm package → ensure library is maintained
- **Duration detection failure:** ffprobe not installed → provide clear error message

### Out of Scope
- Video transcoding to meet duration limits (defer to Phase 3)
- Advanced format validation (use basic magic number check)

---

## Sub-Phase 1.3: Storage Management (Week 2, Days 1-2)

### Goal
Implement storage cleanup and quota management to prevent disk space exhaustion.

### Tasks

#### 1.3.1 Storage Cleanup Strategy
- **Deliverable:** Automatic cleanup of old/unused files
- **Owner:** Backend agent
- **Depends-on:** None
- **Size:** M (1 day)
- **Acceptance:**
  - Cleans up failed upload files
  - Removes videos not referenced in database
  - Implements LRU cache for storage management
  - Provides storage usage reporting
  - Configurable cleanup policies

**Implementation approach:**
```typescript
// core/api/src/services/storageManager.ts
export class StorageManager {
  async cleanupOrphanedFiles(): Promise<number> {
    const allFiles = await fs.readdir(this.storageDir);
    const dbFiles = this.videosRepo.list().map(v => v.file_path);
    
    const orphaned = allFiles.filter(f => !dbFiles.includes(f));
    for (const file of orphaned) {
      await fs.unlink(path.join(this.storageDir, file));
    }
    
    return orphaned.length;
  }
  
  async enforceStorageQuota(maxGB: number): Promise<void> {
    const usage = await this.getStorageUsage();
    if (usage.gb > maxGB) {
      await this.cleanupLRU(maxGB);
    }
  }
}
```

#### 1.3.2 Disk Space Monitoring
- **Deliverable:** Pre-upload disk space checks and monitoring
- **Owner:** Backend agent
- **Depends-on:** 1.3.1
- **Size:** S (0.5 day)
- **Acceptance:**
  - Checks available disk space before upload
  - Prevents uploads when space insufficient
  - Provides storage usage endpoint
  - Implements cleanup when space low
  - Monitors storage usage trends

**Implementation approach:**
```typescript
// core/api/src/services/storageManager.ts
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
```

### Risks
- **Cleanup mistakes:** Deleting referenced files → implement safety checks
- **Disk space calculation errors:** Cross-platform issues → test on multiple platforms

### Out of Scope
- Cloud storage integration (use local storage for Phase 1)
- Automatic storage expansion (manual cleanup only)

---

## Sub-Phase 1.4: Enhanced Quota Management (Week 2, Days 3-4)

### Goal
Complete quota management logic for YouTube API limits.

### Tasks

#### 1.4.1 YouTube Quota Implementation
- **Deliverable:** Complete YouTube API quota tracking and enforcement
- **Owner:** Backend agent
- **Depends-on:** Existing quota table schema
- **Size:** M (1 day)
- **Acceptance:**
  - Tracks daily YouTube API quota usage (10,000 units/day)
  - Calculates quota cost per operation
  - Prevents uploads when quota insufficient
  - Provides quota status endpoint
  - Resets quota daily at midnight UTC
  - Implements quota tier warnings

**Implementation approach:**
```typescript
// core/worker/src/services/quotaManager.ts
const YOUTUBE_QUOTA_LIMIT = 10000; // units per day
const UPLOAD_COST = 1600; // units per video upload

export class QuotaManager {
  async checkQuota(accountId: string): Promise<boolean> {
    const today = this.getTodayWindow();
    const usage = await this.quotasRepo.getUsage('youtube', today);
    
    if (usage.used + UPLOAD_COST > usage.limit) {
      return false;
    }
    
    return true;
  }
  
  async recordUpload(accountId: string): Promise<void> {
    const today = this.getTodayWindow();
    await this.quotasRepo.incrementUsage('youtube', UPLOAD_COST);
  }
  
  private getTodayWindow(): number {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDay())).getTime();
  }
}
```

#### 1.4.2 Quota UI Integration
- **Deliverable:** API endpoints for quota status and user notifications
- **Owner:** Backend agent
- **Depends-on:** 1.4.1
- **Size:** S (0.5 day)
- **Acceptance:**
  - GET /api/quota/youtube endpoint
  - Shows current usage and remaining quota
  - Provides quota reset time
  - Warns when quota running low (80% threshold)
  - Returns clear error when quota exceeded

**Implementation approach:**
```typescript
// core/api/src/routes/quota.ts
app.get('/quota/youtube', async () => {
  const today = getTodayWindow();
  const quota = await quotasRepo.getUsage('youtube', today);
  
  return {
    platform: 'youtube',
    used: quota.used,
    limit: quota.limit,
    remaining: quota.limit - quota.used,
    reset_at: quota.window_start + 86400000, // +24 hours
    warning: quota.used / quota.limit > 0.8
  };
});
```

### Risks
- **Quota calculation errors:** Incorrect API costs → verify with YouTube documentation
- **Timezone issues:** Reset timing incorrect → use UTC consistently

### Out of Scope
- Paid quota tiers (defer to Phase 2)
- Multi-platform quota coordination (YouTube only for Phase 1)

---

## Sub-Phase 1.5: Integration & Testing (Week 2, Days 5)

### Goal
End-to-end integration testing of new YouTube upload functionality.

### Tasks

#### 1.5.1 Real YouTube Upload Test
- **Deliverable:** End-to-end test with real YouTube API
- **Owner:** Full-stack agent
- **Depends-on:** All previous sub-phases
- **Size:** M (1 day)
- **Acceptance:**
  - Upload test video to real YouTube account
  - Verify video appears on YouTube
  - Test progress tracking during upload
  - Validate quota deduction
  - Test error scenarios (quota exceeded, network failure)

**Test approach:**
```typescript
// integration/youtubeUpload.test.ts
describe('Real YouTube Upload', () => {
  it('should upload video to YouTube successfully', async () => {
    const testVideo = await createTestVideo('test-upload.mp4', 10MB);
    const account = await getTestYouTubeAccount();
    
    const result = await uploadToYouTube(testVideo, account);
    
    expect(result.youtubeId).toBeDefined();
    expect(result.url).toContain('youtube.com');
    
    // Verify on YouTube
    const youtubeVideo = await youtubeClient.videos.get(result.youtubeId);
    expect(youtubeVideo.snippet.title).toBe(testVideo.title);
  });
});
```

#### 1.5.2 Error Scenario Validation
- **Deliverable:** Test error handling with real YouTube API errors
- **Owner:** Backend agent
- **Depends-on:** 1.5.1
- **Size:** S (0.5 day)
- **Acceptance:**
  - Test quota exceeded scenario
  - Test network interruption handling
  - Test invalid file format rejection
  - Test expired token refresh
  - Test storage cleanup

### Risks
- **Real API costs:** Testing consumes quota → use test account with small files
- **Test data cleanup:** Test videos accumulate on YouTube → implement cleanup

### Out of Scope
- Load testing (defer to Phase 2)
- Multi-user testing (single account only)

---

## Phase 1 Acceptance Criteria

### Functional Requirements
- [ ] Real YouTube upload integration works with authenticated accounts
- [ ] Streaming upload handles large files without memory issues
- [ ] Real-time progress tracking visible in UI
- [ ] Magic number file detection prevents spoofed files
- [ ] Storage cleanup prevents disk space exhaustion
- [ ] YouTube quota management prevents API limit errors
- [ ] Enhanced duration validation respects YouTube limits

### Technical Requirements
- [ ] No memory leaks during large file uploads
- [ ] YouTube API quota tracked accurately
- [ ] Storage cleanup doesn't delete referenced files
- [ ] Magic number detection uses reliable library
- [ ] Disk space checks work cross-platform
- [ ] Progress tracking handles connection drops

### Performance Requirements
- [ ] Large file uploads (>500MB) complete successfully
- [ ] Memory usage remains stable during uploads
- [ ] Storage cleanup completes within reasonable time
- [ ] Quota checks add minimal overhead to upload process

---

## Phase 1 Dependencies

### External Dependencies
- YouTube API access and valid credentials
- Google APIs Node.js client library
- file-type library for magic number detection
- ffmpeg and ffprobe for video processing
- Stable internet connection for uploads

### Internal Dependencies
- Existing OAuth implementation (✅ complete)
- Existing video upload endpoint (✅ complete)
- Existing worker scheduling logic (✅ complete)
- Existing database schema (✅ complete)
- Existing token refresh logic (✅ complete)

---

## Phase 1 Risks & Mitigations

### High Risk
1. **YouTube API Integration Complexity**
   - Mitigation: Start with simple upload, add resumable upload if needed
   - Stop condition: >3 days debugging API integration issues

2. **Streaming Upload Memory Issues**
   - Mitigation: Test with various file sizes, monitor memory usage
   - Stop condition: Memory usage grows linearly with file size

### Medium Risk
1. **Magic Number Library Compatibility**
   - Mitigation: Choose well-maintained library, test with various file types
   - Stop condition: Library fails to detect common video formats

2. **Storage Cleanup Safety**
   - Mitigation: Implement double-check before deletion, test thoroughly
   - Stop condition: Cleanup deletes referenced files

### Low Risk
1. **Quota Calculation Accuracy**
   - Mitigation: Verify with YouTube documentation, test with real uploads
   - Stop condition: Quota tracking doesn't match actual API usage

---

## Phase 1 Success Metrics

### Quantitative
- Real YouTube upload success rate: >90%
- Large file upload (>500MB) success rate: >85%
- Storage cleanup accuracy: 100% (no referenced files deleted)
- Quota tracking accuracy: ±5% of actual API usage
- Magic number detection accuracy: >95%

### Qualitative
- Users can upload videos to YouTube successfully
- Progress tracking provides clear feedback during uploads
- Storage management prevents disk space issues
- Quota management prevents API limit errors
- File validation rejects spoofed files effectively

---

## Phase 1 Deliverables

### Code Deliverables
- Real YouTube API upload client (`core/worker/src/publishers/youtube.ts`)
- Streaming upload implementation (`core/worker/src/publishers/youtubeStreaming.ts`)
- Real-time progress tracking (`core/api/src/routes/uploadProgress.ts`)
- Magic number file detection (`core/api/src/services/fileTypeDetector.ts`)
- Enhanced duration validation (`core/api/src/services/videoService.ts`)
- Storage cleanup manager (`core/api/src/services/storageManager.ts`)
- Disk space monitoring (`core/api/src/services/storageManager.ts`)
- YouTube quota manager (`core/worker/src/services/quotaManager.ts`)
- Quota status endpoint (`core/api/src/routes/quota.ts`)

### Documentation Deliverables
- YouTube API integration guide
- Storage management documentation
- Quota management user guide
- Troubleshooting guide for YouTube upload issues

### Testing Deliverables
- Real YouTube upload integration tests
- Error scenario test cases
- Storage cleanup validation tests
- Quota tracking accuracy tests

---

## Next Steps After Phase 1

1. **Immediate:** Deploy updated Phase 1 to staging environment
2. **Validation:** Conduct real YouTube upload tests with various file sizes
3. **Planning:** Begin Phase 2 infrastructure setup (CI/CD, monitoring)
4. **Monitoring:** Set up YouTube API quota monitoring
5. **Documentation:** Update user guides with YouTube upload instructions

---

**Phase 1 Status:** Ready to start  
**Estimated Completion:** 1-2 weeks (reduced based on existing codebase)  
**Dependencies:** Existing OAuth, video upload, worker logic (all complete)  
**Blockers:** YouTube API credentials and Google client library setup