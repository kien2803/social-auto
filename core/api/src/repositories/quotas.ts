import type { Platform } from '@social-auto/shared';
import type { DB } from '../db.js';

export const PLATFORM_DAILY_LIMIT: Record<Platform, number> = {
  youtube: 10_000,
  tiktok: 100,
  instagram: 200,
  facebook: 200,
};

export const UNITS_PER_UPLOAD: Record<Platform, number> = {
  youtube: 1600,
  tiktok: 1,
  instagram: 1,
  facebook: 1,
};

export class QuotasRepo {
  constructor(private db: DB) {}

  /**
   * Read (or create on first use) the per-day quota row for a platform.
   * The schema's `quotas` table has columns:
   *   id, platform, window_start, used, "limit", updated_at
   * — note `window_start` is the start of the day (UTC midnight) and
   * `"limit"` is the daily budget. The schema is the source of truth;
   * the SQL here must match. The previous version used `date` and
   * `daily_limit`, which would have thrown "no such column" on a fresh
   * DB and on the worker's :memory: tests.
   */
  private rowForToday(platform: Platform, now: number): { used: number; limit: number; windowStart: number } {
    const result = this.db.raw.exec(
      'SELECT used, "limit", window_start FROM quotas WHERE platform = ? AND window_start = ?',
      [platform, Date.UTC(
        new Date(now).getUTCFullYear(),
        new Date(now).getUTCMonth(),
        new Date(now).getUTCDate(),
      )],
    );
    const first = result[0]?.values[0];
    if (first) {
      return {
        used: first[0] as number,
        limit: first[1] as number,
        windowStart: first[2] as number,
      };
    }
    const limit = PLATFORM_DAILY_LIMIT[platform];
    const windowStart = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    // ON CONFLICT DO NOTHING makes this idempotent across processes
    // (API + worker both hold their own sql.js handle). If the row
    // already exists for today, we leave it alone and re-read it below.
    this.db.raw.run(
      `INSERT INTO quotas (platform, window_start, used, "limit", updated_at)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT (platform, window_start) DO NOTHING`,
      [platform, windowStart, limit, now],
    );
    const reread = this.db.raw.exec(
      'SELECT used, "limit", window_start FROM quotas WHERE platform = ? AND window_start = ?',
      [platform, windowStart],
    );
    const r = reread[0]?.values[0];
    if (r) {
      return {
        used: r[0] as number,
        limit: r[1] as number,
        windowStart: r[2] as number,
      };
    }
    return { used: 0, limit, windowStart };
  }
  get(platform: Platform, now: number): { used: number; limit: number; remaining: number } {
    const row = this.rowForToday(platform, now);
    return { used: row.used, limit: row.limit, remaining: Math.max(0, row.limit - row.used) };
  }

  incrementUsage(platform: Platform, units: number, now: number = Date.now()): void {
    this.rowForToday(platform, now);
    this.db.raw.run(
      'UPDATE quotas SET used = used + ?, updated_at = ? WHERE platform = ? AND window_start = ?',
      [units, now, platform, Date.UTC(
        new Date(now).getUTCFullYear(),
        new Date(now).getUTCMonth(),
        new Date(now).getUTCDate(),
      )],
    );
  }

  hasRemaining(platform: Platform, now: number = Date.now()): boolean {
    const q = this.get(platform, now);
    return q.remaining >= UNITS_PER_UPLOAD[platform];
  }
}
