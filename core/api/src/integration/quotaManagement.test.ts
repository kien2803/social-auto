/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures use loose JSON shapes */
/**
 * Integration Test: Quota Management
 *
 * This test suite validates quota management functionality:
 * 1. Quota tracking per platform
 * 2. Quota enforcement (hasRemaining)
 * 3. Per-platform quota status (get)
 *
 * Prerequisites:
 * - API server running on http://localhost:3000
 * - Database initialized
 * - QuotasRepo available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDB } from '../db.js';
import { QuotasRepo } from '../repositories/quotas.js';
import path from 'node:path';
import fs from 'node:fs/promises';

const TEST_DB_PATH = path.join(process.cwd(), 'test-quota.db');

describe('Quota Management Integration', () => {
  let db: any;
  let quotas: QuotasRepo;

  beforeAll(async () => {
    db = await openDB(TEST_DB_PATH);
    quotas = new QuotasRepo(db);
  });

  afterAll(async () => {
    await db.close();
    await fs.unlink(TEST_DB_PATH).catch(() => {});
  });

  describe('Quota Tracking', () => {
    it('should track quota usage per platform', () => {
      quotas.incrementUsage('youtube', 1);

      const status = quotas.get('youtube', Date.now());
      expect(status.used).toBeGreaterThanOrEqual(1);
    });

    it('should track quota for multiple platforms', () => {
      quotas.incrementUsage('youtube', 1);
      quotas.incrementUsage('tiktok', 1);
      quotas.incrementUsage('instagram', 1);

      const yt = quotas.get('youtube', Date.now());
      const tt = quotas.get('tiktok', Date.now());
      const ig = quotas.get('instagram', Date.now());

      expect(yt.used).toBeGreaterThanOrEqual(1);
      expect(tt.used).toBeGreaterThanOrEqual(1);
      expect(ig.used).toBeGreaterThanOrEqual(1);
    });

    it('should accumulate usage correctly', () => {
      const before = quotas.get('youtube', Date.now());
      const beforeUsed = before.used;

      quotas.incrementUsage('youtube', 5);

      const after = quotas.get('youtube', Date.now());
      expect(after.used).toBeGreaterThanOrEqual(beforeUsed + 5);
    });
  });

  describe('Quota Enforcement', () => {
    it('should report hasRemaining correctly', () => {
      const ytHas = quotas.hasRemaining('youtube', Date.now());
      expect(typeof ytHas).toBe('boolean');
    });

    it('should block when quota exhausted', () => {
      // Exhaust the quota by incrementing well beyond the daily limit
      const yt = quotas.get('youtube', Date.now());
      quotas.incrementUsage('youtube', yt.limit + 1000);

      const stillHas = quotas.hasRemaining('youtube', Date.now());
      expect(stillHas).toBe(false);
    });
  });

  describe('Quota Status', () => {
    it('should return quota status for a platform', () => {
      const status = quotas.get('youtube', Date.now());

      expect(typeof status.used).toBe('number');
      expect(typeof status.limit).toBe('number');
      expect(typeof status.remaining).toBe('number');
      expect(status.remaining).toBeLessThanOrEqual(status.limit);
    });

    it('should calculate remaining quota correctly', () => {
      quotas.incrementUsage('youtube', 50);

      const status = quotas.get('youtube', Date.now());
      // remaining is Math.max(0, limit - used), so equality only holds when used <= limit
      expect(status.remaining).toBe(Math.max(0, status.limit - status.used));
    });
  });

  describe('Platform-Specific Quotas', () => {
    it('should return per-platform quota status', () => {
      const yt = quotas.get('youtube', Date.now());
      const tt = quotas.get('tiktok', Date.now());
      const ig = quotas.get('instagram', Date.now());
      const fb = quotas.get('facebook', Date.now());

      expect(yt.limit).toBeGreaterThan(0);
      expect(tt.limit).toBeGreaterThan(0);
      expect(ig.limit).toBeGreaterThan(0);
      expect(fb.limit).toBeGreaterThan(0);
    });

    it('should track platform-specific costs', () => {
      const before = quotas.get('youtube', Date.now());
      const beforeUsed = before.used;

      quotas.incrementUsage('youtube', 1600);

      const after = quotas.get('youtube', Date.now());
      expect(after.used).toBeGreaterThanOrEqual(beforeUsed + 1600);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', () => {
      db.close();
      expect(() => quotas.incrementUsage('youtube', 1)).toThrow();
    });
  });
});
