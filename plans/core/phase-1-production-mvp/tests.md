# Phase 1: Core Functionality - Test Plan

**Purpose:** Focused testing strategy for Phase 1 YouTube upload integration  
**Timeline:** Parallel with development (1-2 weeks)  
**Coverage:** Integration tests, real API tests, error scenario tests

---

## Test Strategy Overview

### Focused Testing Approach
- **Integration Tests (70%):** Real YouTube API integration testing
- **Error Scenario Tests (20%):** Network failures, quota issues, API errors
- **Performance Tests (10%):** Large file handling, memory usage

### Test Categories
1. **YouTube API Integration:** Real upload, streaming, progress tracking
2. **Error Handling:** Network failures, quota exceeded, authentication errors
3. **Storage Management:** Cleanup, disk space, orphaned files
4. **File Validation:** Magic number detection, duration validation

---

## Sub-Phase 1.1: YouTube Upload Integration Tests

### Integration Tests

#### 1.1.1 Real YouTube Upload Test
```typescript
// core/worker/src/integration/youtubeUpload.test.ts
describe('Real YouTube Upload Integration', () => {
  it('should upload video to YouTube successfully', async () => {
    // Setup
    const testVideo = await createTestVideo('test-upload.mp4', 10MB);
    const account = await getTestYouTubeAccount();
    
    // Upload
    const uploader = new YouTubeUploader();
    const result = await uploader.upload(testVideo, account);
    
    // Verify
    expect(result.youtubeId).toBeDefined();
    expect(result.url).toContain('youtube.com');
    
    // Verify on YouTube
    const youtubeVideo = await youtubeClient.videos.get(result.youtubeId);
    expect(youtubeVideo.snippet.title).toBe(testVideo.title);
  });

  it('should handle large file upload', async () => {
    const largeVideo = await createTestVideo('large-upload.mp4', 500MB);
    const account = await getTestYouTubeAccount();
    
    const uploader = new YouTubeUploader();
    const result = await uploader.upload(largeVideo, account);
    
    expect(result.youtubeId).toBeDefined();
    // Verify memory usage stayed stable
    expect(getMemoryUsage()).toBeLessThan(200MB);
  });
});
```

#### 1.1.2 Streaming Upload Test
```typescript
// core/worker/src/integration/streamingUpload.test.ts
describe('Streaming Upload', () => {
  it('should stream large files without memory issues', async () => {
    const largeVideo = await createTestVideo('stream-test.mp4', 1GB);
    const account = await getTestYouTubeAccount();
    
    const initialMemory = getMemoryUsage();
    const uploader = new YouTubeUploader();
    
    await uploader.upload(largeVideo, account);
    
    const finalMemory = getMemoryUsage();
    const memoryIncrease = finalMemory - initialMemory;
    
    // Memory increase should be minimal (not proportional to file size)
    expect(memoryIncrease).toBeLessThan(50MB);
  });

  it('should handle network interruption during streaming', async () => {
    const video = await createTestVideo('interrupt-test.mp4', 100MB);
    const account = await getTestYouTubeAccount();
    
    // Simulate network interruption at 50%
    mockNetwork.interruptAt(50);
    
    const uploader = new YouTubeUploader();
    const result = await uploader.upload(video, account);
    
    // Should either fail with clear error or resume successfully
    expect(result.status).toMatch(/failed|completed/);
  });
});
```

#### 1.1.3 Progress Tracking Test
```typescript
// core/api/src/integration/progressTracking.test.ts
describe('Progress Tracking', () => {
  it('should provide real-time progress updates', async () => {
    const video = await createTestVideo('progress-test.mp4', 50MB);
    const account = await getTestYouTubeAccount();
    
    const progressUpdates: number[] = [];
    const uploader = new YouTubeUploader({
      onProgress: (progress) => progressUpdates.push(progress)
    });
    
    await uploader.upload(video, account);
    
    // Should have received multiple progress updates
    expect(progressUpdates.length).toBeGreaterThan(5);
    // Progress should be monotonically increasing
    expect(progressUpdates).toEqual(progressUpdates.sort((a, b) => a - b));
    // Final progress should be 100%
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });
});
```

---

## Sub-Phase 1.2: File Validation Tests

### Integration Tests

#### 1.2.1 Magic Number Detection Test
```typescript
// core/api/src/integration/fileTypeDetection.test.ts
describe('Magic Number File Detection', () => {
  it('should detect real file format using magic numbers', async () => {
    // Create MP4 file with .txt extension (spoofed)
    const spoofedFile = await createSpoofedFile('spoofed.txt', 'mp4');
    
    const detector = new FileTypeDetector();
    const detectedType = await detector.detectRealFileType(spoofFile.path);
    
    expect(detectedType).toBe('mp4');
  });

  it('should reject files with invalid magic numbers', async () => {
    // Create text file with .mp4 extension
    const invalidFile = await createInvalidFile('invalid.mp4', 'text');
    
    const detector = new FileTypeDetector();
    
    await expect(detector.detectRealFileType(invalidFile.path))
      .rejects.toThrow('Invalid video format');
  });

  it('should handle various video formats correctly', async () => {
    const formats = ['mp4', 'mov', 'webm'];
    const detector = new FileTypeDetector();
    
    for (const format of formats) {
      const file = await createTestVideo(`test.${format}`, 10MB, format);
      const detected = await detector.detectRealFileType(file.path);
      expect(detected).toBe(format);
    }
  });
});
```

#### 1.2.2 Duration Validation Test
```typescript
// core/api/src/integration/durationValidation.test.ts
describe('Duration Validation', () => {
  it('should accept videos within YouTube limits', async () => {
    const normalVideo = await createTestVideo('normal.mp4', 10MB, 'mp4', 300); // 5 minutes
    const validator = new DurationValidator();
    
    const result = validator.validate(normalVideo.path);
    expect(result.valid).toBe(true);
  });

  it('should reject videos exceeding YouTube maximum', async () => {
    const longVideo = await createTestVideo('long.mp4', 100MB, 'mp4', 50000); // >12 hours
    const validator = new DurationValidator();
    
    const result = validator.validate(longVideo.path);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds YouTube maximum');
  });

  it('should warn about videos exceeding recommended duration', async () => {
    const longVideo = await createTestVideo('long.mp4', 50MB, 'mp4', 1200); // 20 minutes
    const validator = new DurationValidator();
    
    const result = validator.validate(longVideo.path);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain('exceeds YouTube recommended');
  });
});
```

---

## Sub-Phase 1.3: Storage Management Tests

### Integration Tests

#### 1.3.1 Storage Cleanup Test
```typescript
// core/api/src/integration/storageCleanup.test.ts
describe('Storage Cleanup', () => {
  it('should clean up orphaned files', async () => {
    // Create some orphaned files
    await createOrphanedFile('orphan1.mp4');
    await createOrphanedFile('orphan2.mp4');
    
    const manager = new StorageManager();
    const cleanedCount = await manager.cleanupOrphanedFiles();
    
    expect(cleanedCount).toBe(2);
    
    // Verify files are deleted
    expect(fileExists('orphan1.mp4')).toBe(false);
    expect(fileExists('orphan2.mp4')).toBe(false);
  });

  it('should not delete referenced files', async () => {
    // Create video in database
    const video = await createTestVideo('protected.mp4', 10MB);
    await db.videos.insert(video);
    
    const manager = new StorageManager();
    await manager.cleanupOrphanedFiles();
    
    // File should still exist
    expect(fileExists(video.path)).toBe(true);
  });

  it('should enforce storage quota', async () => {
    // Fill storage near quota
    await fillStorageToQuota(9GB); // Assuming 10GB quota
    
    const manager = new StorageManager();
    await manager.enforceStorageQuota(10GB);
    
    const usage = await manager.getStorageUsage();
    expect(usage.gb).toBeLessThanOrEqual(10GB);
  });
});
```

#### 1.3.2 Disk Space Monitoring Test
```typescript
// core/api/src/integration/diskSpace.test.ts
describe('Disk Space Monitoring', () => {
  it('should check disk space before upload', async () => {
    const manager = new StorageManager();
    const largeFile = await createTestVideo('large.mp4', 2GB);
    
    // Mock low disk space
    mockDiskSpace(1GB); // Only 1GB available
    
    const canUpload = await manager.checkDiskSpace(largeFile.size);
    expect(canUpload).toBe(false);
  });

  it('should provide storage usage endpoint', async () => {
    const manager = new StorageManager();
    const usage = await manager.getStorageUsage();
    
    expect(usage.gb).toBeGreaterThan(0);
    expect(usage.files).toBeGreaterThan(0);
    expect(usage.availableGB).toBeGreaterThan(0);
  });
});
```

---

## Sub-Phase 1.4: Quota Management Tests

### Integration Tests

#### 1.4.1 YouTube Quota Tracking Test
```typescript
// core/worker/src/integration/quotaManagement.test.ts
describe('YouTube Quota Management', () => {
  it('should track quota usage correctly', async () => {
    const quotaManager = new QuotaManager();
    
    // Record upload
    await quotaManager.recordUpload('test-account');
    
    const usage = await quotaManager.getUsage('youtube');
    expect(usage.used).toBe(1600); // YouTube upload cost
  });

  it('should prevent uploads when quota exceeded', async () => {
    const quotaManager = new QuotaManager();
    
    // Set quota to near limit
    await quotaManager.setUsage('youtube', 9000); // 1000 remaining
    
    const canUpload = await quotaManager.checkQuota('test-account');
    expect(canUpload).toBe(false); // 1600 cost > 1000 remaining
  });

  it('should reset quota daily', async () => {
    const quotaManager = new QuotaManager();
    
    // Set usage for today
    await quotaManager.setUsage('youtube', 5000);
    
    // Mock time advancing to next day
    mockTime(Date.now() + 86400000);
    
    const usage = await quotaManager.getUsage('youtube');
    expect(usage.used).toBe(0); // Should reset
  });
});
```

#### 1.4.2 Quota Endpoint Test
```typescript
// core/api/src/integration/quotaEndpoint.test.ts
describe('Quota Endpoint', () => {
  it('should return quota status', async () => {
    const response = await request(app).get('/quota/youtube');
    
    expect(response.status).toBe(200);
    expect(response.body.platform).toBe('youtube');
    expect(response.body.used).toBeGreaterThanOrEqual(0);
    expect(response.body.limit).toBe(10000);
    expect(response.body.remaining).toBeGreaterThanOrEqual(0);
  });

  it('should show warning when quota low', async () => {
    // Set quota to 80%+ usage
    await quotaManager.setUsage('youtube', 8500);
    
    const response = await request(app).get('/quota/youtube');
    expect(response.body.warning).toBe(true);
  });
});
```

---

## Error Scenario Tests

### Network Failure Scenarios
```typescript
// error-scenarios/networkFailures.test.ts
describe('Network Failure Scenarios', () => {
  it('should handle network timeout during upload', async () => {
    mockNetwork.timeout(true);
    
    const video = await createTestVideo('timeout-test.mp4', 50MB);
    const account = await getTestYouTubeAccount();
    
    const uploader = new YouTubeUploader();
    const result = await uploader.upload(video, account);
    
    expect(result.status).toBe('failed');
    expect(result.error).toContain('timeout');
  });

  it('should retry on transient network errors', async () => {
    let attemptCount = 0;
    mockNetwork.intermittentFailure(2); // Fail first 2 attempts
    
    const video = await createTestVideo('retry-test.mp4', 20MB);
    const account = await getTestYouTubeAccount();
    
    const uploader = new YouTubeUploader();
    const result = await uploader.upload(video, account);
    
    expect(result.status).toBe('completed');
    expect(attemptCount).toBe(3); // 2 failures + 1 success
  });
});
```

### Authentication Scenarios
```typescript
// error-scenarios/authFailures.test.ts
describe('Authentication Scenarios', () => {
  it('should refresh expired token automatically', async () => {
    const account = await createTestAccount();
    account.tokenExpiry = Date.now() - 1000; // Expired
    
    const video = await createTestVideo('auth-test.mp4', 10MB);
    const uploader = new YouTubeUploader();
    
    const result = await uploader.upload(video, account);
    
    expect(result.status).toBe('completed');
    
    // Verify token was refreshed
    const updatedAccount = await db.accounts.findByPk(account.id);
    expect(updatedAccount.tokenExpiry).toBeGreaterThan(Date.now());
  });

  it('should handle revoked access gracefully', async () => {
    const account = await createTestAccount();
    mockYouTubeClient.revokeAccess(account.id);
    
    const video = await createTestVideo('revoke-test.mp4', 10MB);
    const uploader = new YouTubeUploader();
    
    const result = await uploader.upload(video, account);
    
    expect(result.status).toBe('failed');
    expect(result.error).toContain('revoked');
    
    // Account should be marked as expired
    const updatedAccount = await db.accounts.findByPk(account.id);
    expect(updatedAccount.status).toBe('expired');
  });
});
```

### Quota Error Scenarios
```typescript
// error-scenarios/quotaErrors.test.ts
describe('Quota Error Scenarios', () => {
  it('should prevent upload when quota exceeded', async () => {
    await quotaManager.setUsage('youtube', 9500); // Only 500 remaining
    
    const video = await createTestVideo('quota-test.mp4', 10MB);
    const account = await getTestYouTubeAccount();
    
    const uploader = new YouTubeUploader();
    const result = await uploader.upload(video, account);
    
    expect(result.status).toBe('failed');
    expect(result.error).toContain('quota');
  });

  it('should schedule retry when quota exhausted', async () => {
    await quotaManager.setUsage('youtube', 10000); // Fully exhausted
    
    const video = await createTestVideo('quota-retry-test.mp4', 10MB);
    const account = await getTestYouTubeAccount();
    const scheduledPost = await createScheduledPost(Date.now(), video.id, account.id);
    
    const worker = new Worker();
    await worker.processPost(scheduledPost);
    
    const updatedPost = await db.scheduledPosts.findByPk(scheduledPost.id);
    expect(updatedPost.status).toBe('pending'); // Should be scheduled for retry
    expect(updatedPost.next_retry_at).toBeGreaterThan(Date.now());
  });
});
```

---

## Performance Tests

### Large File Upload Performance
```typescript
// performance/largeFileUpload.test.ts
describe('Large File Upload Performance', () => {
  it('should handle 500MB file without memory issues', async () => {
    const largeVideo = await createTestVideo('perf-500mb.mp4', 500MB);
    const account = await getTestYouTubeAccount();
    
    const initialMemory = getMemoryUsage();
    const startTime = Date.now();
    
    const uploader = new YouTubeUploader();
    await uploader.upload(largeVideo, account);
    
    const duration = Date.now() - startTime;
    const finalMemory = getMemoryUsage();
    const memoryIncrease = finalMemory - initialMemory;
    
    expect(duration).toBeLessThan(300000); // 5 minutes max
    expect(memoryIncrease).toBeLessThan(100MB); // Memory should not grow much
  });

  it('should handle 1GB file with streaming', async () => {
    const hugeVideo = await createTestVideo('perf-1gb.mp4', 1GB);
    const account = await getTestYouTubeAccount();
    
    const memorySamples: number[] = [];
    const uploader = new YouTubeUploader({
      onProgress: () => memorySamples.push(getMemoryUsage())
    });
    
    await uploader.upload(hugeVideo, account);
    
    // Memory should remain stable throughout upload
    const maxMemory = Math.max(...memorySamples);
    const minMemory = Math.min(...memorySamples);
    const memoryVariance = maxMemory - minMemory;
    
    expect(memoryVariance).toBeLessThan(50MB); // Memory variance should be small
  });
});
```

### Storage Cleanup Performance
```typescript
// performance/storageCleanup.test.ts
describe('Storage Cleanup Performance', () => {
  it('should cleanup large number of files efficiently', async () => {
    // Create 1000 orphaned files
    await createOrphanedFiles(1000);
    
    const manager = new StorageManager();
    const startTime = Date.now();
    
    const cleanedCount = await manager.cleanupOrphanedFiles();
    
    const duration = Date.now() - startTime;
    
    expect(cleanedCount).toBe(1000);
    expect(duration).toBeLessThan(10000); // Should complete in <10 seconds
  });
});
```

---

## Test Execution Plan

### Test Automation
```bash
# YouTube integration tests (requires real credentials)
YOUTUBE_TEST_CREDENTIALS=true pnpm test:integration:youtube

# File validation tests
pnpm test:integration:validation

# Storage management tests
pnpm test:integration:storage

# Quota management tests
pnpm test:integration:quota

# Error scenario tests
pnpm test:error:scenarios

# Performance tests
pnpm test:performance

# All integration tests
pnpm test:integration
```

### Test Environment Setup
- Use dedicated YouTube test account
- Set low quota limits for testing
- Mock network failures for error scenarios
- Clean up test data after each run

---

## Test Success Criteria

### Integration Test Success
- [ ] Real YouTube upload works with test account
- [ ] Streaming upload handles large files (>500MB)
- [ ] Progress tracking provides real-time updates
- [ ] Magic number detection rejects spoofed files
- [ ] Storage cleanup doesn't delete referenced files
- [ ] Quota tracking matches actual API usage

### Error Scenario Success
- [ ] Network failures trigger appropriate retries
- [ ] Authentication errors handled gracefully
- [ ] Quota errors prevent uploads and schedule retries
- [ ] Invalid files rejected with clear errors

### Performance Test Success
- [ ] Large file uploads complete within time limits
- [ ] Memory usage remains stable during uploads
- [ ] Storage cleanup completes efficiently
- [ ] Progress tracking adds minimal overhead

---

**Test Plan Status:** Ready for execution  
**Test Execution Timeline:** Parallel with Phase 1 development  
**Test Ownership:** Development team with YouTube API access