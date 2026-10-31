import { Hono } from 'hono';
import { QuotasRepo, UNITS_PER_UPLOAD } from '../repos/quotas';
import { bearerUserId } from '../lib/auth';
import type { Platform } from '../repos/types';
import type { Env } from '../env';

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];

function nextMidnightUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86_400_000;
}

export const quotaRoutes = new Hono<{ Bindings: Env }>();

quotaRoutes.get('/quota', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const quotas = new QuotasRepo(c.env.DB);
  const now = Date.now();
  const items = [];
  for (const platform of PLATFORMS) {
    const q = await quotas.get(platform, now);
    items.push({
      platform,
      used: q.used,
      limit: q.limit,
      remaining: q.remaining,
      mine: await quotas.getUserUsage(userId, platform, now),
      reset_at: nextMidnightUtc(now),
      warning: q.used / q.limit > 0.8,
    });
  }
  return c.json({ quotas: items, now });
});

quotaRoutes.get('/quota/youtube', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const quotas = new QuotasRepo(c.env.DB);
  const now = Date.now();
  const q = await quotas.get('youtube', now);
  return c.json({
    platform: 'youtube',
    used: q.used,
    limit: q.limit,
    remaining: q.remaining,
    reset_at: nextMidnightUtc(now),
    warning: q.used / q.limit > 0.8,
    upload_cost: UNITS_PER_UPLOAD.youtube,
    uploads_remaining: Math.floor(q.remaining / UNITS_PER_UPLOAD.youtube),
  });
});
