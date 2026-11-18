import type { Env } from '../env';

/**
 * Signed public media URLs — Instagram's crawler pulls video_url with no
 * credentials, so the URL itself carries a short-lived HMAC grant:
 *
 *   GET /api/media/<videoId>?e=<expiryMs>&s=<hmac(videoId.expiry)>
 *
 * TTL is capped (default 15 min) so a leaked link dies quickly. The
 * signature key is JWT_SECRET — already a per-deploy secret.
 */

const MAX_TTL_MS = 30 * 60 * 1000;

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signMediaUrl(env: Env, videoId: string, ttlMs = 15 * 60 * 1000): Promise<string> {
  const expiry = Date.now() + Math.min(ttlMs, MAX_TTL_MS);
  const sig = await hmacHex(`${videoId}.${expiry}`, env.JWT_SECRET);
  return `${env.WEB_ORIGIN}/api/media/${videoId}?e=${expiry}&s=${sig}`;
}

export async function verifyMediaSig(env: Env, videoId: string, expiry: number, sig: string): Promise<boolean> {
  if (!Number.isFinite(expiry) || expiry < Date.now() || expiry > Date.now() + MAX_TTL_MS) return false;
  if (!/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = await hmacHex(`${videoId}.${expiry}`, env.JWT_SECRET);
  // Constant-time-ish compare — both hex strings, same length.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
