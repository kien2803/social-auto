import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from '../db.js';
import { QuotasRepo } from './quotas.js';
import type { DB } from '../db.js';

const UTC_MIDNIGHT = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d); // m is 1-based for readability

let db: DB;
let quotas: QuotasRepo;

beforeEach(async () => {
  db = await openDB(':memory:');
  quotas = new QuotasRepo(db);
});

describe('QuotasRepo', () => {
  it('returns 0 used / full remaining on a fresh day', () => {
    const t = UTC_MIDNIGHT(2026, 9, 8);
    const q = quotas.get('tiktok', t);
    expect(q.used).toBe(0);
    expect(q.remaining).toBe(100);
  });

  it('persists used count across calls within the same UTC day', () => {
    const morning = UTC_MIDNIGHT(2026, 9, 8) + 60 * 60 * 1000;
    const evening = UTC_MIDNIGHT(2026, 9, 8) + 22 * 60 * 60 * 1000;
    quotas.incrementUsage('tiktok', 3, morning);
    quotas.incrementUsage('tiktok', 5, evening);
    const q = quotas.get('tiktok', evening);
    expect(q.used).toBe(8);
  });

  it('resets used across UTC day boundary (regression: UNIQUE(platform, window_start))', () => {
    // Before the fix, the schema's UNIQUE(platform) caused the second day's
    // INSERT to throw UNIQUE constraint failed. The fix is the composite
    // UNIQUE(platform, window_start) + ON CONFLICT DO NOTHING.
    const day1 = UTC_MIDNIGHT(2026, 9, 8);
    const day2 = UTC_MIDNIGHT(2026, 9, 9);
    quotas.incrementUsage('tiktok', 50, day1);
    // Reading on the next day must not throw, must report used=0.
    const q = quotas.get('tiktok', day2);
    expect(q.used).toBe(0);
    expect(q.remaining).toBe(100);
  });

  it('handles concurrent insert races idempotently', () => {
    // Two API/worker processes hitting the same platform/day key: the
    // ON CONFLICT DO NOTHING path must not throw, and both reads return
    // the same row.
    const t = UTC_MIDNIGHT(2026, 9, 8);
    quotas.get('tiktok', t);
    quotas.get('tiktok', t); // second open/insert path
    quotas.get('tiktok', t);
    const q = quotas.get('tiktok', t);
    expect(q.used).toBe(0);
  });

  it('hasRemaining returns false once used >= daily limit', () => {
    const t = UTC_MIDNIGHT(2026, 9, 8);
    quotas.incrementUsage('tiktok', 99, t);
    expect(quotas.hasRemaining('tiktok', t)).toBe(true);
    quotas.incrementUsage('tiktok', 1, t);
    expect(quotas.hasRemaining('tiktok', t)).toBe(false);
  });
});