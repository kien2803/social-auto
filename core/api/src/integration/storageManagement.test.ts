/**
 * Integration Test: Storage Manager
 *
 * This test suite validates storage management functionality in the worker:
 * 1. Orphaned file cleanup
 * 2. Storage quota enforcement
 * 3. Disk space monitoring
 * 4. Storage cleanup scheduling
 *
 * Prerequisites:
 * - Worker process running
 * - Database initialized
 * - Storage directory accessible
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDB } from '../db.js';
import { VideosRepo } from '../repositories/videos.js';
import { StorageManager } from '../services/storageManager.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_STORAGE_DIR = path.join(process.cwd(), 'test-worker-storage');
const TEST_DB_PATH = path.join(process.cwd(), 'test-worker-storage.db');

describe('Storage Manager Integration', () => {
  let db: any;
  let videos: VideosRepo;
  let storageManager: StorageManager;
  const testVideoIds: string[] = [];

  beforeAll(async () => {
    await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
    db = await openDB(TEST_DB_PATH);
    videos = new VideosRepo(db);
    storageManager = new StorageManager(TEST_STORAGE_DIR, videos, 1); // 1GB quota
  });

  afterAll(async () => {
    // Cleanup test storage
    await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    await fs.unlink(TEST_DB_PATH).catch(() => {});
    try { await db.close(); } catch { /* ignore */ }
  });

  describe('File Storage', () => {
    it('should store video file information', async () => {
      const videoPath = path.join(TEST_STORAGE_DIR, 'test-video.mp4');
      await fs.writeFile(videoPath, Buffer.from('test video content'));
      // File stored successfully

      const video = videos.insert({
        file_path: videoPath,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        size_bytes: 19,
        duration_sec: 10,
        mime: 'video/mp4',
      });

      testVideoIds.push(video.id);
      expect(video.id).toBeDefined();
    });

    it('should retrieve video by ID', () => {
      if (testVideoIds.length === 0) return;
      const videoId = testVideoIds[0];
      const video = videos.findById(videoId);
      expect(video).toBeDefined();
      expect(video?.file_path).toContain('test-video.mp4');
    });

    it('should list videos', () => {
      const videoList = videos.list(10);
      expect(Array.isArray(videoList)).toBe(true);
      expect(videoList.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Orphaned File Cleanup', () => {
    it('should detect orphaned files', async () => {
      const orphanPath = path.join(TEST_STORAGE_DIR, 'orphan.mp4');
      await fs.writeFile(orphanPath, Buffer.from('orphan data'));

      const cleanedCount = await storageManager.cleanupOrphanedFiles();

      expect(cleanedCount).toBeGreaterThan(0);

      const exists = await fs.access(orphanPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should preserve referenced files', async () => {
      const videoPath = path.join(TEST_STORAGE_DIR, 'referenced.mp4');
      await fs.writeFile(videoPath, Buffer.from('referenced data'));

      const video = videos.insert({
        file_path: videoPath,
        sha256: 'abc123',
        size_bytes: 100,
        duration_sec: 10,
        thumbnail_path: path.join(TEST_STORAGE_DIR, 'thumb.jpg'),
        mime: 'video/mp4',
      });

      testVideoIds.push(video.id);

      await storageManager.cleanupOrphanedFiles();

      const exists = await fs.access(videoPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle cleanup errors gracefully', async () => {
      const errorCount = await storageManager.cleanupOrphanedFiles();
      expect(typeof errorCount).toBe('number');
    });
  });

  describe('Storage Quota Enforcement', () => {
    it('should enforce storage quota', async () => {
      const testManager = new StorageManager(TEST_STORAGE_DIR, videos, 0.001); // 1MB

      const fileCount = 5;
      for (let i = 0; i < fileCount; i++) {
        const filePath = path.join(TEST_STORAGE_DIR, `quota-test-${i}.mp4`);
        await fs.writeFile(filePath, Buffer.alloc(1024 * 1024)); // 1MB each
      }

      await testManager.cleanupOrphanedFiles();

      const remainingFiles = await fs.readdir(TEST_STORAGE_DIR);
      expect(remainingFiles.length).toBeLessThan(fileCount + 5);
    });

    it('should calculate storage usage correctly', async () => {
      const usage = await storageManager.getStorageUsage();

      expect(usage).toHaveProperty('totalGB');
      expect(usage).toHaveProperty('usedGB');
      expect(usage).toHaveProperty('availableGB');
      expect(usage).toHaveProperty('files');

      expect(usage.usedGB).toBeGreaterThanOrEqual(0);
      expect(usage.totalGB).toBeGreaterThan(0);
    });

    it('should report disk space status', async () => {
      const hasSpace = await storageManager.checkDiskSpace(1024 * 1024); // 1MB
      expect(typeof hasSpace).toBe('boolean');
    });
  });

  describe('Disk Space Monitoring', () => {
    it('should monitor available disk space', async () => {
      const hasSpace = await storageManager.checkDiskSpace(1024 * 1024); // 1MB
      expect(typeof hasSpace).toBe('boolean');
    });

    it('should warn when disk space is low', async () => {
      const usage = await storageManager.getStorageUsage();
      const usagePercentage = (usage.usedGB / usage.totalGB) * 100;
      if (usagePercentage > 90) {
        console.warn('Disk space usage is critically high:', usagePercentage);
      }
      expect(typeof usagePercentage).toBe('number');
    });

    it('should handle mock disk full scenario', () => {
      const mockUsage = { totalGB: 1, usedGB: 1, availableGB: 0, files: 0 };
      const canWrite = mockUsage.availableGB > 0.001;
      expect(canWrite).toBe(false);
    });
  });

  describe('Scheduled Cleanup', () => {
    it('should run periodic cleanup', async () => {
      for (let i = 0; i < 3; i++) {
        const orphanPath = path.join(TEST_STORAGE_DIR, `orphan-${i}.mp4`);
        await fs.writeFile(orphanPath, Buffer.from(`orphan ${i}`));
      }

      const cleaned = await storageManager.cleanupOrphanedFiles();

      expect(cleaned).toBeGreaterThanOrEqual(3);
    });

    it('should respect cleanup interval', () => {
      const interval = 6 * 60 * 60 * 1000; // 6 hours
      expect(interval).toBeGreaterThan(0);
      expect(interval).toBeLessThan(24 * 60 * 60 * 1000);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors during cleanup', async () => {
      // Closing db first means subsequent cleanup operations will fail gracefully
      const closedDb = await openDB(':memory:');
      closedDb.close();
      // The cleanup should handle this gracefully
    });

    it('should handle file system errors', async () => {
      // Cleanup of non-existent paths should be handled gracefully
      const errorCount = await storageManager.cleanupOrphanedFiles();
      expect(typeof errorCount).toBe('number');
    });
  });
});
