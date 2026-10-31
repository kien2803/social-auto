import type { Context } from 'hono';
import type { Env } from '../env';

/** Fixed-window rate limit backed by D1 — shared across all worker
 *  instances, unlike an in-memory map. key = e.g. 'login:1.2.3.4'.
 *  Returns a 429 Response when over the limit, else null. */
export async function rateLimit(
  c: Context<{ Bindings: Env }>,
  key: string,
  limit: number,
  windowSec: number,
): Promise<Response | null> {
  const now = Date.now();
  const windowStart = Math.floor(now / 1000 / windowSec) * windowSec * 1000;
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1, updated_at = ?
     RETURNING count`,
  )
    .bind(key.slice(0, 200), windowStart, now, now)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count <= limit) return null;
  const retryAfter = Math.ceil((windowStart + windowSec * 1000 - now) / 1000);
  return c.json(
    { error: 'too_many_requests', retry_after: retryAfter },
    429,
    { 'retry-after': String(retryAfter) },
  );
}

export function clientIp(c: Context<{ Bindings: Env }>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
