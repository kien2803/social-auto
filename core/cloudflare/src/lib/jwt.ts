import { SignJWT, jwtVerify } from 'jose';

const encoder = () => new TextEncoder();

/** tv = users.token_version — bump it to revoke every outstanding token
 *  (password change, "sign out everywhere"). Old tokens without tv are
 *  treated as tv=0. */
export async function signToken(userId: string, secret: string, tv: number = 0): Promise<string> {
  return new SignJWT({ userId, tv })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encoder().encode(secret));
}

export async function verifyToken(token: string, secret: string): Promise<{ userId: string; tv: number }> {
  const { payload } = await jwtVerify(token, encoder().encode(secret));
  const userId = payload['userId'];
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid token payload');
  const tv = payload['tv'];
  return { userId, tv: typeof tv === 'number' ? tv : 0 };
}
