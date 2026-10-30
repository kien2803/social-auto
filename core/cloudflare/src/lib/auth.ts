import { verifyToken } from './jwt';
import type { Env } from '../env';

/** Bearer JWT → userId, or null. Shared by every authed /api route. */
export async function bearerUserId(c: {
  req: { header: (n: string) => string | undefined };
  env: Env;
}): Promise<string | null> {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  try {
    return await verifyToken(h.slice(7), c.env.JWT_SECRET);
  } catch {
    return null;
  }
}
