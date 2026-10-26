import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AccountsRepo } from '../repos/accounts';
import { verifyToken } from '../lib/jwt';
import { encrypt } from '../lib/crypto';
import type { Env } from '../env';

export const oauthRoutes = new Hono<{ Bindings: Env }>();

const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

function cookieOpts(env: Env) {
  const secure = env.WEB_ORIGIN.startsWith('https://');
  return { path: '/auth', httpOnly: true, sameSite: 'Lax' as const, secure, maxAge: 600 };
}

async function cookieUserId(c: { req: { raw: Request }; env: Env }): Promise<string | null> {
  const t = getCookie({ req: c.req } as never, 'oauth_token');
  if (!t) return null;
  try { return await verifyToken(t, c.env.JWT_SECRET); } catch { return null; }
}

oauthRoutes.get('/auth/youtube/start', (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_REDIRECT_URI) {
    return c.json({ error: 'Google OAuth not configured' }, 503);
  }
  const state = crypto.randomUUID();
  setCookie(c, 'oauth_state', state, cookieOpts(c.env));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', c.env.GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

oauthRoutes.get('/auth/callback', async (c) => {
  const { code, state, error } = c.req.query() as { code?: string; state?: string; error?: string };
  const savedState = getCookie({ req: c.req } as never, 'oauth_state');
  deleteCookie(c, 'oauth_state', { path: '/auth' });
  const origin = c.env.WEB_ORIGIN;
  if (error) return c.redirect(`${origin}/accounts?error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== savedState) return c.redirect(`${origin}/accounts?error=state_mismatch`);

  const userId = await cookieUserId(c);
  deleteCookie(c, 'oauth_token', { path: '/auth' });
  if (!userId) return c.redirect(`${origin}/login`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID!,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string };
  if (!tokens.access_token || !tokens.refresh_token) {
    return c.redirect(`${origin}/accounts?error=${encodeURIComponent(tokens.error ?? 'token_exchange_failed')}`);
  }

  const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const ch = (await chRes.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
  const channel = ch.items?.[0];
  if (!channel) return c.redirect(`${origin}/accounts?error=no_youtube_channel`);

  const accounts = new AccountsRepo(c.env.DB);
  const encAccess = await encrypt(tokens.access_token, c.env.TOKEN_ENCRYPTION_KEY);
  const encRefresh = await encrypt(tokens.refresh_token, c.env.TOKEN_ENCRYPTION_KEY);
  const existing = await accounts.findByPlatformExternal('youtube', channel.id);
  if (existing && existing.user_id !== userId) {
    return c.redirect(`${origin}/accounts?error=account_owned_by_other_user`);
  }
  if (existing) {
    await c.env.DB.prepare('UPDATE accounts SET oauth_access_token = ?, oauth_refresh_token = ?, status = ? WHERE id = ?')
      .bind(encAccess, encRefresh, 'active', existing.id).run();
  } else {
    await accounts.insert({
      user_id: userId,
      platform: 'youtube',
      external_id: channel.id,
      display_name: channel.snippet.title,
      oauth_refresh_token: encRefresh,
      oauth_access_token: encAccess,
    });
  }
  return c.redirect(`${origin}/accounts?connected=youtube`);
});

oauthRoutes.get('/auth/youtube/status', async (c) => {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return c.json({ connected: false }, 401);
  let userId: string;
  try { userId = await verifyToken(h.slice(7), c.env.JWT_SECRET); } catch { return c.json({ connected: false }, 401); }
  const list = await new AccountsRepo(c.env.DB).listByPlatform('youtube', userId);
  return c.json({ connected: list.length > 0, configured: !!c.env.GOOGLE_CLIENT_ID, accounts: list });
});
