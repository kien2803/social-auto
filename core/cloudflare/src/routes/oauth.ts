import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AccountsRepo } from '../repos/accounts';
import { verifyToken } from '../lib/jwt';
import { encrypt, decrypt } from '../lib/crypto';
import { generatePKCE } from '../lib/pkce';
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

  const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const ch = (await chRes.json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> };
      statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
    }>;
  };
  const channel = ch.items?.[0];
  if (!channel) return c.redirect(`${origin}/accounts?error=no_youtube_channel`);

  // Persist the channel snapshot on connect so the row lands with real
  // stats instead of waiting for a manual sync click.
  const t = channel.snippet.thumbnails ?? {};
  const handle = channel.snippet.customUrl ?? '';
  const stat = channel.statistics ?? {};
  const snapshot = {
    channel_handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '',
    avatar_url: t.high?.url ?? t.medium?.url ?? t.default?.url ?? '',
    subscribers: stat.subscriberCount != null ? Number(stat.subscriberCount) : null,
    views: stat.viewCount != null ? Number(stat.viewCount) : null,
    video_count: stat.videoCount != null ? Number(stat.videoCount) : null,
    last_sync_at: Date.now(),
  };

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
    await accounts.updateChannelSnapshot(existing.id, snapshot);
  } else {
    const row = await accounts.insert({
      user_id: userId,
      platform: 'youtube',
      external_id: channel.id,
      display_name: channel.snippet.title,
      oauth_refresh_token: encRefresh,
      oauth_access_token: encAccess,
    });
    await accounts.updateChannelSnapshot(row.id, snapshot);
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

// ──────────────────────────────────────────────────────────────────────────
// TikTok OAuth (Login Kit + PKCE S256)
// ──────────────────────────────────────────────────────────────────────────

const TIKTOK_SCOPES = 'user.info.basic,video.upload,video.publish';
const TIKTOK_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USERINFO = 'https://open.tiktokapis.com/v2/user/info/';

oauthRoutes.get('/auth/tiktok/start', async (c) => {
  if (!c.env.TIKTOK_CLIENT_KEY || !c.env.TIKTOK_REDIRECT_URI) {
    return c.json({ error: 'TikTok OAuth not configured' }, 503);
  }
  const state = crypto.randomUUID();
  const { verifier, challenge } = await generatePKCE();
  const opts = cookieOpts(c.env);
  setCookie(c, 'oauth_state', state, opts);
  setCookie(c, 'tiktok_code_verifier', verifier, opts);
  const url = new URL(TIKTOK_AUTHORIZE);
  url.searchParams.set('client_key', c.env.TIKTOK_CLIENT_KEY);
  url.searchParams.set('scope', TIKTOK_SCOPES);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', c.env.TIKTOK_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return c.redirect(url.toString());
});

oauthRoutes.get('/auth/tiktok/callback', async (c) => {
  const { code, state, error } = c.req.query() as { code?: string; state?: string; error?: string };
  const savedState = getCookie({ req: c.req } as never, 'oauth_state');
  const verifier = getCookie({ req: c.req } as never, 'tiktok_code_verifier');
  deleteCookie(c, 'oauth_state', { path: '/auth' });
  deleteCookie(c, 'tiktok_code_verifier', { path: '/auth' });
  const origin = c.env.WEB_ORIGIN;
  if (error) return c.redirect(`${origin}/accounts?error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== savedState) return c.redirect(`${origin}/accounts?error=state_mismatch`);
  if (!verifier) return c.redirect(`${origin}/accounts?error=missing_code_verifier`);

  const userId = await cookieUserId(c);
  deleteCookie(c, 'oauth_token', { path: '/auth' });
  if (!userId) return c.redirect(`${origin}/login`);

  const tokenRes = await fetch(TIKTOK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: c.env.TIKTOK_CLIENT_KEY!,
      client_secret: c.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: c.env.TIKTOK_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
    error?: string;
  };
  if (!tokens.access_token || !tokens.refresh_token || !tokens.open_id) {
    return c.redirect(`${origin}/accounts?error=${encodeURIComponent(tokens.error ?? 'token_exchange_failed')}`);
  }

  const userRes = await fetch(`${TIKTOK_USERINFO}?fields=open_id,display_name,avatar_url`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const userJson = (await userRes.json()) as {
    data?: { user?: { open_id: string; display_name?: string; avatar_url?: string } };
  };
  const user = userJson.data?.user;
  if (!user?.open_id) return c.redirect(`${origin}/accounts?error=no_tiktok_user`);

  const accounts = new AccountsRepo(c.env.DB);
  const encAccess = await encrypt(tokens.access_token, c.env.TOKEN_ENCRYPTION_KEY);
  const encRefresh = await encrypt(tokens.refresh_token, c.env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = Date.now() + (tokens.expires_in ?? 86400) * 1000;
  const existing = await accounts.findByPlatformExternal('tiktok', user.open_id);
  if (existing && existing.user_id !== userId) {
    return c.redirect(`${origin}/accounts?error=account_owned_by_other_user`);
  }
  if (existing) {
    await accounts.updateTokens(existing.id, { access_token: encAccess, refresh_token: encRefresh, expires_at: expiresAt });
    await accounts.updateDisplayName(existing.id, user.display_name ?? 'TikTok User');
    await accounts.updateStatus(existing.id, 'active');
    if (user.avatar_url) await accounts.updateChannelSnapshot(existing.id, { avatar_url: user.avatar_url });
    return c.redirect(`${origin}/accounts?connected=tiktok&account=${existing.id}`);
  }
  const row = await accounts.insert({
    user_id: userId,
    platform: 'tiktok',
    external_id: user.open_id,
    display_name: user.display_name ?? 'TikTok User',
    oauth_refresh_token: encRefresh,
    oauth_access_token: encAccess,
    token_expires_at: expiresAt,
  });
  if (user.avatar_url) await accounts.updateChannelSnapshot(row.id, { avatar_url: user.avatar_url });
  return c.redirect(`${origin}/accounts?connected=tiktok&account=${row.id}`);
});

// ──────────────────────────────────────────────────────────────────────────
// Meta OAuth (Facebook Pages + linked Instagram business accounts)
// ──────────────────────────────────────────────────────────────────────────

const META_SCOPES = [
  'public_profile', 'email', 'pages_show_list', 'pages_manage_posts',
  'pages_read_engagement', 'instagram_basic', 'instagram_content_publish',
].join(',');

function metaDialogUrl(c: { env: Env }, state: string): string {
  const v = c.env.META_API_VERSION || 'v24.0';
  const url = new URL(`https://www.facebook.com/${v}/dialog/oauth`);
  url.searchParams.set('client_id', c.env.META_APP_ID!);
  url.searchParams.set('redirect_uri', c.env.META_REDIRECT_URI!);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', META_SCOPES);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

function metaGraph(c: { env: Env }, path: string, params: Record<string, string>): string {
  const v = c.env.META_API_VERSION || 'v24.0';
  const url = new URL(`https://graph.facebook.com/${v}${path}`);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  return url.toString();
}

async function metaStart(c: { env: Env; redirect: (u: string) => Response; json: (o: object, s?: number) => Response }) {
  if (!c.env.META_APP_ID || !c.env.META_APP_SECRET || !c.env.META_REDIRECT_URI) {
    return c.json({ error: 'Meta OAuth not configured' }, 503);
  }
  const state = crypto.randomUUID();
  setCookie(c as never, 'oauth_state', state, cookieOpts(c.env));
  return c.redirect(metaDialogUrl(c, state));
}

// Instagram + Facebook connect through the single Meta dialog — one flow
// creates rows for every managed Page and its linked IG business account.
oauthRoutes.get('/auth/meta/start', (c) => metaStart(c));
oauthRoutes.get('/auth/instagram/start', (c) => metaStart(c));
oauthRoutes.get('/auth/facebook/start', (c) => metaStart(c));

oauthRoutes.get('/auth/meta/callback', async (c) => {
  const { code, state, error } = c.req.query() as { code?: string; state?: string; error?: string };
  const savedState = getCookie({ req: c.req } as never, 'oauth_state');
  deleteCookie(c, 'oauth_state', { path: '/auth' });
  const origin = c.env.WEB_ORIGIN;
  if (error) return c.redirect(`${origin}/accounts?error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== savedState) return c.redirect(`${origin}/accounts?error=state_mismatch`);

  const userId = await cookieUserId(c);
  deleteCookie(c, 'oauth_token', { path: '/auth' });
  if (!userId) return c.redirect(`${origin}/login`);

  // Exchange code → short-lived token → long-lived token (60 days).
  const exRes = await fetch(
    metaGraph(c, '/oauth/access_token', {
      client_id: c.env.META_APP_ID!,
      client_secret: c.env.META_APP_SECRET!,
      redirect_uri: c.env.META_REDIRECT_URI!,
      code,
    }),
  );
  if (!exRes.ok) return c.redirect(`${origin}/accounts?error=token_exchange_failed`);
  const ex = (await exRes.json()) as { access_token?: string };
  if (!ex.access_token) return c.redirect(`${origin}/accounts?error=token_exchange_failed`);

  let durable = ex.access_token;
  let expiresAt: number | null = null;
  try {
    const llRes = await fetch(
      metaGraph(c, '/oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: c.env.META_APP_ID!,
        client_secret: c.env.META_APP_SECRET!,
        fb_exchange_token: ex.access_token,
      }),
    );
    const ll = (await llRes.json()) as { access_token?: string; expires_in?: number };
    if (ll.access_token) {
      durable = ll.access_token;
      expiresAt = ll.expires_in ? Date.now() + ll.expires_in * 1000 : null;
    }
  } catch {
    /* short-lived fallback is fine */
  }

  const pagesRes = await fetch(
    metaGraph(c, '/me/accounts', {
      access_token: durable,
      fields: 'id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url}',
    }),
  );
  const pagesJson = (await pagesRes.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      access_token?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
    }>;
  };
  const pages = (pagesJson.data ?? []).filter((p) => p.id && p.access_token);
  if (!pages.length) return c.redirect(`${origin}/accounts?error=no_pages`);

  const accounts = new AccountsRepo(c.env.DB);
  const insertedIds: string[] = [];
  for (const p of pages) {
    const rows: Array<{ platform: 'facebook' | 'instagram'; externalId: string; name: string; avatar?: string; token: string }> = [
      { platform: 'facebook', externalId: p.id, name: p.name ?? p.id, avatar: p.picture?.data?.url, token: p.access_token! },
    ];
    if (p.instagram_business_account?.id) {
      rows.push({
        platform: 'instagram',
        externalId: p.instagram_business_account.id,
        name: p.instagram_business_account.username
          ? `@${p.instagram_business_account.username}`
          : p.instagram_business_account.id,
        avatar: p.instagram_business_account.profile_picture_url ?? p.picture?.data?.url,
        token: p.access_token!,
      });
    }
    for (const r of rows) {
      const encAccess = await encrypt(r.token, c.env.TOKEN_ENCRYPTION_KEY);
      const encRefresh = await encrypt(`meta-refresh-${r.externalId}`, c.env.TOKEN_ENCRYPTION_KEY);
      const existing = await accounts.findByPlatformExternal(r.platform, r.externalId);
      if (existing) {
        if (existing.user_id !== userId) {
          return c.redirect(`${origin}/accounts?error=account_owned_by_other_user`);
        }
        await accounts.updateTokens(existing.id, { access_token: encAccess, refresh_token: encRefresh, expires_at: expiresAt });
        await accounts.updateDisplayName(existing.id, r.name);
        await accounts.updateStatus(existing.id, 'active');
        if (r.avatar) await accounts.updateChannelSnapshot(existing.id, { avatar_url: r.avatar });
        insertedIds.push(existing.id);
      } else {
        const row = await accounts.insert({
          user_id: userId,
          platform: r.platform,
          external_id: r.externalId,
          display_name: r.name,
          oauth_refresh_token: encRefresh,
          oauth_access_token: encAccess,
          token_expires_at: expiresAt,
        });
        if (r.avatar) await accounts.updateChannelSnapshot(row.id, { avatar_url: r.avatar });
        insertedIds.push(row.id);
      }
    }
  }
  return c.redirect(`${origin}/accounts?connected=meta&accounts=${insertedIds.join(',')}`);
});

// ──────────────────────────────────────────────────────────────────────────
// Per-platform status — bearer-auth, user-scoped. TikTok validates live via
// user.info; Meta platforms return stored state (token is page-scoped, the
// /me check would say little about a specific page).
// ──────────────────────────────────────────────────────────────────────────

async function statusUserId(c: { req: { header: (n: string) => string | undefined }; env: Env }): Promise<string | null> {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  try { return await verifyToken(h.slice(7), c.env.JWT_SECRET); } catch { return null; }
}

oauthRoutes.get('/auth/tiktok/status', async (c) => {
  const userId = await statusUserId(c);
  if (!userId) return c.json({ connected: false }, 401);
  const rows = await new AccountsRepo(c.env.DB).listByPlatform('tiktok', userId);
  if (!rows.length) return c.json({ connected: false, configured: !!c.env.TIKTOK_CLIENT_KEY, accounts: [] });
  const accounts = [];
  for (const row of rows) {
    let status = row.status;
    if (status === 'active' && row.oauth_access_token) {
      try {
        const token = await decrypt(row.oauth_access_token, c.env.TOKEN_ENCRYPTION_KEY);
        const res = await fetch(`${TIKTOK_USERINFO}?fields=open_id`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) status = 'expired';
      } catch {
        status = 'expired';
      }
    }
    accounts.push({ id: row.id, platform: 'tiktok', display_name: row.display_name, status });
  }
  return c.json({ connected: true, configured: !!c.env.TIKTOK_CLIENT_KEY, accounts });
});

for (const platform of ['instagram', 'facebook'] as const) {
  oauthRoutes.get(`/auth/${platform}/status`, async (c) => {
    const userId = await statusUserId(c);
    if (!userId) return c.json({ connected: false }, 401);
    const rows = await new AccountsRepo(c.env.DB).listByPlatform(platform, userId);
    return c.json({
      connected: rows.length > 0,
      configured: !!c.env.META_APP_ID,
      accounts: rows.map((r) => ({ id: r.id, platform, display_name: r.display_name, status: r.status })),
    });
  });
}
