import { SignJWT, jwtVerify } from 'jose';

const encoder = () => new TextEncoder();

export async function signToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encoder().encode(secret));
}

export async function verifyToken(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, encoder().encode(secret));
  const userId = payload['userId'];
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid token payload');
  return userId;
}
