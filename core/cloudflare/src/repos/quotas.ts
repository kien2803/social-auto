import type { Platform } from './types';

export const PLATFORM_DAILY_LIMIT: Record<Platform, number> = {
  youtube: 10_000,
  tiktok: 100,
  instagram: 200,
  facebook: 200,
};

export const UNITS_PER_UPLOAD: Record<Platform, number> = {
  youtube: 1600, // YouTube Data API v3 videos.insert cost
  tiktok: 1,
  instagram: 1,
  facebook: 1,
};

function utcDayStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export class QuotasRepo {
  constructor(private db: D1Database) {}

  private async rowForToday(platform: Platform, now: number) {
    const windowStart = utcDayStart(now);
    const existing = await this.db
      .prepare('SELECT used, "limit" FROM quotas WHERE platform = ? AND window_start = ?')
      .bind(platform, windowStart)
      .first<{ used: number; limit: number }>();
    if (existing) return existing;
    await this.db
      .prepare(
        `INSERT INTO quotas (platform, window_start, used, "limit", updated_at)
         VALUES (?, ?, 0, ?, ?) ON CONFLICT (platform, window_start) DO NOTHING`,
      )
      .bind(platform, windowStart, PLATFORM_DAILY_LIMIT[platform], now)
      .run();
    const reread = await this.db
      .prepare('SELECT used, "limit" FROM quotas WHERE platform = ? AND window_start = ?')
      .bind(platform, windowStart)
      .first<{ used: number; limit: number }>();
    return reread ?? { used: 0, limit: PLATFORM_DAILY_LIMIT[platform] };
  }

  async get(platform: Platform, now: number = Date.now()) {
    const row = await this.rowForToday(platform, now);
    return { used: row.used, limit: row.limit, remaining: Math.max(0, row.limit - row.used) };
  }

  async incrementUsage(platform: Platform, units: number, now: number = Date.now(), userId?: string): Promise<void> {
    await this.rowForToday(platform, now);
    await this.db
      .prepare('UPDATE quotas SET used = used + ?, updated_at = ? WHERE platform = ? AND window_start = ?')
      .bind(units, now, platform, utcDayStart(now))
      .run();
    // Global row is the platform API cap; quota_usage is this user's own
    // consumption — both counters, different semantics.
    if (userId) {
      const windowStart = utcDayStart(now);
      await this.db
        .prepare(
          `INSERT INTO quota_usage (user_id, platform, window_start, used, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, platform, window_start) DO UPDATE SET used = used + ?, updated_at = ?`,
        )
        .bind(userId, platform, windowStart, units, now, units, now)
        .run();
    }
  }

  /** This user's own usage for today — drives per-user fair-use checks. */
  async getUserUsage(userId: string, platform: Platform, now: number = Date.now()): Promise<number> {
    const row = await this.db
      .prepare('SELECT used FROM quota_usage WHERE user_id = ? AND platform = ? AND window_start = ?')
      .bind(userId, platform, utcDayStart(now))
      .first<{ used: number }>();
    return row?.used ?? 0;
  }

  async hasRemaining(platform: Platform, now: number = Date.now()): Promise<boolean> {
    const q = await this.get(platform, now);
    return q.remaining >= UNITS_PER_UPLOAD[platform];
  }
}
