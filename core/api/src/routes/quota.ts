import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Platform } from '@social-auto/shared';
import { UNITS_PER_UPLOAD, type QuotasRepo } from '../repositories/quotas.js';

export interface QuotaDeps {
  quotas: QuotasRepo;
  authMiddleware?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

interface QuotaWire {
  platform: Platform;
  used: number;
  limit: number;
  remaining: number;
  reset_at: number;
  warning: boolean;
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
  const auth = deps.authMiddleware ? { preHandler: deps.authMiddleware } : {};
  app.get('/quota', auth, async () => {
    const now = Date.now();
    const items: QuotaWire[] = (
      ['youtube', 'tiktok', 'instagram', 'facebook'] as Platform[]
    ).map((platform) => {
      const q = deps.quotas.get(platform, now);
      const warning = q.used / q.limit > 0.8; // Warning at 80% usage
      return {
        platform,
        used: q.used,
        limit: q.limit,
        remaining: q.remaining,
        reset_at: nextMidnightUtc(now),
        warning,
      };
    });
    return { quotas: items, now };
  });
  
  // YouTube-specific quota endpoint with more details
  app.get('/quota/youtube', auth, async () => {
    const now = Date.now();
    const q = deps.quotas.get('youtube', now);
    const warning = q.used / q.limit > 0.8;
    
    return {
      platform: 'youtube',
      used: q.used,
      limit: q.limit,
      remaining: q.remaining,
      reset_at: nextMidnightUtc(now),
      warning,
      upload_cost: UNITS_PER_UPLOAD.youtube,
      uploads_remaining: Math.floor(q.remaining / UNITS_PER_UPLOAD.youtube)
    };
  });
}
