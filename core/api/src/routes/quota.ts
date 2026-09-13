import type { FastifyInstance } from 'fastify';
import type { Platform } from '@social-auto/shared';
import type { QuotasRepo } from '../repositories/quotas.js';

export interface QuotaDeps {
  quotas: QuotasRepo;
}

interface QuotaWire {
  platform: Platform;
  used: number;
  limit: number;
  remaining: number;
  reset_at: number;
}

/** Next 00:00 UTC, in ms epoch. Matches the per-day window the worker uses. */
function nextMidnightUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
  );
}

/**
 * Returns the per-platform quota snapshot. Each row uses `used` against
 * `limit` so the UI can render "YouTube: 4500/10000 units today" and warn
 * when remaining falls below one upload's worth. `reset_at` is the next
 * midnight UTC so clients can show a countdown without re-deriving it.
 */
export function registerQuotaRoutes(app: FastifyInstance, deps: QuotaDeps): void {
  app.get('/quota', async () => {
    const now = Date.now();
    const items: QuotaWire[] = (
      ['youtube', 'tiktok', 'instagram', 'facebook'] as Platform[]
    ).map((platform) => {
      const q = deps.quotas.get(platform, now);
      return {
        platform,
        used: q.used,
        limit: q.limit,
        remaining: q.remaining,
        reset_at: nextMidnightUtc(now),
      };
    });
    return { quotas: items, now };
  });
}
