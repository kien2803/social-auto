import { verifyToken } from './jwt';
import type { Env } from '../env';

/** Bearer JWT → userId, or null. Shared by every authed /api route.
 *  Verifies the token_version claim against users.token_version so a
 *  password change or "sign out everywhere" actually revokes tokens.
 *  Cost: one extra D1 read per authed request — correctness first. */
export async function bearerUserId(c: {
  req: { header: (n: string) => string | undefined };
  env: Env;
}): Promise<string | null> {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return userIdFromToken(c, h.slice(7));
}

/** Verify a raw JWT + its token_version claim against the DB — used by
 *  both the Authorization-header path and OAuth cookie paths so revoked
 *  tokens die everywhere, not just in bearerUserId. */
export async function userIdFromToken(c: { env: Env }, token: string): Promise<string | null> {
  try {
    const { userId, tv } = await verifyToken(token, c.env.JWT_SECRET);
    const row = await c.env.DB.prepare('SELECT token_version FROM users WHERE id = ?')
      .bind(userId)
      .first<{ token_version: number }>();
    return row && row.token_version === tv ? userId : null;
  } catch {
    return null;
  }
}
