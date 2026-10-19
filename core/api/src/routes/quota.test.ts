import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDB, type DB } from '../db.js';
import { QuotasRepo } from '../repositories/quotas.js';
import { registerQuotaRoutes } from './quota.js';

describe('Quota Routes', () => {
  let app: FastifyInstance;
  let db: DB;
  let quotas: QuotasRepo;
  beforeEach(async () => {
    // Use in-memory database for testing
    db = await openDB(':memory:');
    quotas = new QuotasRepo(db);
    
    // Build a minimal app for testing quota routes only
    app = Fastify({ logger: false });
    registerQuotaRoutes(app, { quotas });
    await app.ready();
  });
  describe('GET /quota', () => {
    it('should return quota data for all platforms', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/quota',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.quotas).toBeDefined();
      expect(data.quotas).toHaveLength(4); // youtube, tiktok, instagram, facebook
      expect(data.now).toBeDefined();
      expect(typeof data.now).toBe('number');
    });

    it('should include warning flag when quota usage is high', async () => {
      // Set high quota usage for YouTube (above 80%)
      quotas.incrementUsage('youtube', 8500, Date.now());

      const response = await app.inject({
        method: 'GET',
        url: '/quota',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      const youtubeQuota = data.quotas.find((q: { platform: string; warning: boolean }) => q.platform === 'youtube');
      expect(youtubeQuota).toBeDefined();
      expect(youtubeQuota.warning).toBe(true);
    });

    it('should not include warning flag when quota usage is low', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/quota',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      const youtubeQuota = data.quotas.find((q: any) => q.platform === 'youtube');
      expect(youtubeQuota).toBeDefined();
      expect(youtubeQuota.warning).toBe(false);
    });
  });

  describe('GET /quota/youtube', () => {
    it('should return YouTube-specific quota data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/quota/youtube',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.platform).toBe('youtube');
      expect(data.used).toBeDefined();
      expect(data.limit).toBe(10000);
      expect(data.remaining).toBeDefined();
      expect(data.reset_at).toBeDefined();
      expect(data.upload_cost).toBe(1600);
      expect(data.uploads_remaining).toBeDefined();
    });

    it('should calculate uploads remaining correctly', async () => {
      // Use some quota
      quotas.incrementUsage('youtube', 3200, Date.now()); // 2 uploads worth

      const response = await app.inject({
        method: 'GET',
        url: '/quota/youtube',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.uploads_remaining).toBeGreaterThanOrEqual(0);
      expect(data.uploads_remaining).toBeLessThanOrEqual(6); // 10000 - 3200 = 6800 / 1600 = 4.25
    });

    it('should show warning when quota is above 80%', async () => {
      quotas.incrementUsage('youtube', 8500, Date.now());

      const response = await app.inject({
        method: 'GET',
        url: '/quota/youtube',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.warning).toBe(true);
    });
  });
});