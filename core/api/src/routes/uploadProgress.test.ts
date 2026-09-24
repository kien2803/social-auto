import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerUploadProgressRoutes, updateProgress, getProgress, cleanupOldProgress, progressCache } from './uploadProgress.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerUploadProgressRoutes(app);
  await app.ready();
  return app;
}

describe('Upload Progress Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  describe('Progress Cache', () => {
    it('should store and retrieve progress data', () => {
      const videoId = 'test-video-123';
      const progress = 50;

      updateProgress(videoId, progress);
      const retrieved = getProgress(videoId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.progress).toBe(progress);
      expect(retrieved?.videoId).toBe(videoId);
      expect(retrieved?.timestamp).toBeDefined();
    });

    it('should clamp progress between 0-100', () => {
      const videoId = 'test-video-clamp';

      updateProgress(videoId, 150); // Above 100
      let retrieved = getProgress(videoId);
      expect(retrieved?.progress).toBe(100);

      updateProgress(videoId, -50); // Below 0
      retrieved = getProgress(videoId);
      expect(retrieved?.progress).toBe(0);
    });

    it('should update existing progress data', () => {
      const videoId = 'test-video-update';

      updateProgress(videoId, 25);
      updateProgress(videoId, 75);

      const retrieved = getProgress(videoId);
      expect(retrieved?.progress).toBe(75);
    });

    it('should return undefined for non-existent video', () => {
      const retrieved = getProgress('non-existent-video');
      expect(retrieved).toBeUndefined();
    });

    it('should clean up old progress entries', () => {
      const videoId1 = 'video-1';
      const videoId2 = 'video-2';
      
      updateProgress(videoId1, 50);
      updateProgress(videoId2, 75);
      
      // Manually set old timestamp by modifying the cache directly
      const oldEntry = progressCache.get(videoId1);
      if (oldEntry) {
        oldEntry.timestamp = Date.now() - 7200000; // 2 hours ago
        progressCache.set(videoId1, oldEntry);
      }
      
      cleanupOldProgress();
      
      expect(getProgress(videoId1)).toBeUndefined();
      expect(getProgress(videoId2)).toBeDefined();
    });
  });

  describe('GET /videos/:id/progress', () => {
    it('should return progress data for existing video', async () => {
      const videoId = 'test-video-456';
      updateProgress(videoId, 75);

      const response = await app.inject({
        method: 'GET',
        url: `/videos/${videoId}/progress`,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.progress).toBe(75);
      expect(data.videoId).toBe(videoId);
    });

    it('should return 404 for non-existent video', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/videos/non-existent/progress',
      });

      expect(response.statusCode).toBe(404);
      const data = JSON.parse(response.payload);
      expect(data.error).toBe('No progress data found');
    });
  });

  describe('POST /videos/:id/progress', () => {
    it('should update progress data', async () => {
      const videoId = 'test-video-789';
      const progress = 60;

      const response = await app.inject({
        method: 'POST',
        url: `/videos/${videoId}/progress`,
        payload: { progress },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);

      // Verify progress was stored
      const retrieved = getProgress(videoId);
      expect(retrieved?.progress).toBe(progress);
    });

    it('should clamp progress on update', async () => {
      const videoId = 'test-video-clamp-post';

      const response = await app.inject({
        method: 'POST',
        url: `/videos/${videoId}/progress`,
        payload: { progress: 150 },
      });

      expect(response.statusCode).toBe(200);

      const retrieved = getProgress(videoId);
      expect(retrieved?.progress).toBe(100);
    });
  });

  describe('DELETE /videos/:id/progress', () => {
    it('should delete progress data', async () => {
      const videoId = 'test-video-delete';
      updateProgress(videoId, 80);

      const response = await app.inject({
        method: 'DELETE',
        url: `/videos/${videoId}/progress`,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);

      // Verify progress was deleted
      expect(getProgress(videoId)).toBeUndefined();
    });
  });
});