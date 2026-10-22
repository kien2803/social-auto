import type { FastifyInstance } from 'fastify';
import { decrypt, encrypt } from '@social-auto/shared/utils/crypto.js';
import type { AccountRow } from '@social-auto/shared';
import { randomBytes } from 'node:crypto';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { GoogleOAuthClient } from '../google/client.js';
import type { TiktokOAuthClient } from '../tiktok/client.js';
import type { MetaOAuthClient } from '../meta/client.js';
import { generatePKCE } from '../auth/pkce.js';
import { getUserId } from '../utils/authHelpers.js';

export interface AuthDeps {
  accounts: AccountsRepo;
  google: GoogleOAuthClient;
  tiktok?: TiktokOAuthClient;
  meta?: MetaOAuthClient;
  /** Where to redirect after OAuth callback (web app). */
  webOrigin: string;
  /** Encryption key for token storage. */
  tokenEncryptionKey: string;
  /** Mounts the legacy IG/FB mock OAuth routes. Driven by `USE_MOCK_PUBLISHERS`. */
  useMockPublishers?: boolean;
  /** Mounts mock /auth/tiktok start+callback when no real TikTok client is
   * configured — otherwise the SPA's "Add TikTok account" 404s. */
  mockTiktok?: boolean;
  /** Optional auth middleware for backward compatibility. */
  optionalAuthMiddleware?: (request: any, reply: any) => Promise<void>;
}
/**
 * Mount OAuth routes for YouTube (Phase 0).
 * Routes:
 *   GET /auth/callback         -> exchange code, store, redirect back
 *   GET /auth/youtube/status   -> { connected, account? }
 */
import {
  POPUP_COOKIE,
  POPUP_QUERY,
  buildAuthRedirect,
  clearOrphanOAuthCookies,
} from '../auth/popupClose.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {


  /** Read the popup-mode opt-in from the inbound request's query string. */
  function readPopupQuery(req: { query: unknown }): boolean {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const raw = q[POPUP_QUERY];
    return raw === '1' || raw === 'true';
  }

  /** Read the popup-mode opt-in from the cookie set by /start?popup=1. */
  function readPopupCookie(req: { cookies: Record<string, string | undefined> }): boolean {
    return req.cookies[POPUP_COOKIE] === '1';
  }

  // Wipe oauth_state / oauth_popup on any 4xx/5xx so a failed YouTube
  // OAuth round-trip never leaves a stale cookie on the browser.
  clearOrphanOAuthCookies(app);

  app.get('/auth/youtube/start', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    reply.setCookie('oauth_state', state, {
      path: '/auth',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    // Popup-mode opt-in: SPA appends ?popup=1 when opening a child window.
    // The cookie survives the OAuth round-trip on the popup window so the
    // callback can redirect to /auth/popup-close instead of /accounts?...
    const popupMode = readPopupQuery(req);
    if (popupMode) {
      reply.setCookie(POPUP_COOKIE, '1', {
        path: '/auth',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
    }
    // The redirect_uri sent to Google must exactly match what's
    // registered for this client_id — otherwise Google's token
    // exchange rejects it. We use the SPA's web origin (env.webOrigin)
    // as the canonical public host. Deriving from X-Forwarded-Host
    // (or even req.headers.host) instead would let any client set
    // the redirect_uri to a domain they control — a host-header
    // injection that would silently re-route OAuth tokens. With
    // trustProxy: true on the Fastify instance, Fastify already
    // surfaces the upstream host in req.headers.host, so env.webOrigin
    // is the only ground truth worth trusting.
    const redirectUri = `${deps.webOrigin}/auth/callback`;
    return reply.redirect(deps.google.buildAuthUrl(state, redirectUri));
  });

  // Wipe oauth_state / oauth_popup on any 4xx/5xx from this route group

  app.get('/auth/callback', { preHandler: deps.optionalAuthMiddleware }, async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    req.log.info({ code: !!code, state: !!state, error, popup: readPopupCookie(req) }, 'oauth callback start');
    const popupMode = readPopupCookie(req);
    if (popupMode) reply.clearCookie(POPUP_COOKIE, { path: '/auth' });
    if (error) {
      const webRedirect = `${deps.webOrigin}/accounts?error=${encodeURIComponent(error)}`;
      return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error }));
    }
    if (!code || !state) {
      return reply.code(400).send({
        error: 'missing code or state',
        hint: 'Google did not include both code and state in the redirect. Common causes: (a) you declined consent on the Google screen, (b) the OAuth app is in Testing mode and your email is not added as a Test user, (c) the redirect_uri in the request did not match the one registered on Google Cloud Console.',
        received_query_keys: Object.keys((req.query ?? {}) as Record<string, unknown>),
      });
    }
    const cookieState = req.cookies['oauth_state'];
    if (!cookieState || cookieState !== state) {
      return reply.code(400).send({ error: 'state mismatch' });
    }
    reply.clearCookie('oauth_state', { path: '/auth' });

    const userId = getUserId(req);
    const tokens = await deps.google.exchangeCode(code);
    req.log.info({ has_refresh: !!tokens.refresh_token, has_access: !!tokens.access_token }, 'oauth token exchange');
    if (!tokens.refresh_token) {
      const msg = 'no refresh token; user must re-authorize with prompt=consent';
      const webRedirect = `${deps.webOrigin}/accounts?error=${encodeURIComponent(msg)}`;
      return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error: msg }));
    }

    const channel = await deps.google.getMyChannel(tokens.access_token);

    const encryptedRefresh = encrypt(tokens.refresh_token, deps.tokenEncryptionKey);
    const encryptedAccess = encrypt(tokens.access_token, deps.tokenEncryptionKey);

    // Persist the channel snapshot on every successful connect. Without
    // this, the row lands with empty channel_handle / avatar_url / null
    // counters and the UI's AccountCard shows "—" for subscribers/views
    // until the user clicks the manual "Sync" button. The snapshot is
    // cheap (already in memory) and idempotent.
    const snapshot = {
      channel_handle: channel.handle ?? '',
      avatar_url: channel.thumbnail_url ?? '',
      subscribers: channel.subscribers,
      views: channel.views,
      video_count: channel.video_count,
      like_count: null,
      avg_watch_seconds: null,
      drop_off_pct: null,
      last_sync_at: channel.snapshot_at || Date.now(),
    };

    const existing = deps.accounts.findByPlatformExternal('youtube', channel.id);
    let accountId: string;
    if (existing) {
      deps.accounts.updateDisplayName(existing.id, channel.title);
      deps.accounts.updateStatus(existing.id, 'active');
      deps.accounts.updateTokens(existing.id, {
        access_token: encryptedAccess,
        expires_at: tokens.expires_at,
      });
      deps.accounts.updateChannelSnapshot(existing.id, snapshot);
      accountId = existing.id;
    } else {
      const row = deps.accounts.insert({
        user_id: userId,
        platform: 'youtube',
        external_id: channel.id,
        display_name: channel.title,
        oauth_refresh_token: encryptedRefresh,
        oauth_access_token: encryptedAccess,
        token_expires_at: tokens.expires_at,
        status: 'active',
        channel: snapshot,
      });
      accountId = row.id;
    }

    const webRedirect = `${deps.webOrigin}/accounts?connected=youtube&account=${accountId}`;
    return reply.redirect(
      buildAuthRedirect(popupMode, webRedirect, {
        connected: 'youtube',
        account_id: accountId,
      }),
    );
  });
  app.get('/auth/youtube/status', async () => {
    // Multi-account: return list of all active YouTube accounts whose stored
    // access token can still decrypt + call YouTube API. Old single-account
    // shape is preserved by keeping `connected: true` plus an `accounts` array.
    const rows = deps.accounts.listByPlatform('youtube');
    if (rows.length === 0) return { connected: false, accounts: [] };
    const accounts: Array<{
      id: string;
      platform: 'youtube';
      display_name: string;
      status: AccountRow['status'];
    }> = [];
    for (const row of rows) {
      if (row.status !== 'active') {
        accounts.push({
          id: row.id,
          platform: 'youtube',
          display_name: row.display_name,
          status: row.status,
        });
        continue;
      }
      let decryptedAccess: string | null = null;
      try {
        decryptedAccess = row.oauth_access_token
          ? decrypt(row.oauth_access_token, deps.tokenEncryptionKey)
          : null;
      } catch {
        accounts.push({
          id: row.id,
          platform: 'youtube',
          display_name: row.display_name,
          status: 'expired' as AccountRow['status'],
        });
        continue;
      }
      if (!decryptedAccess) {
        accounts.push({
          id: row.id,
          platform: 'youtube',
          display_name: row.display_name,
          status: 'expired' as AccountRow['status'],
        });
        continue;
      }
      try {
        const channel = await deps.google.getMyChannel(decryptedAccess);
        accounts.push({
          id: row.id,
          platform: 'youtube',
          display_name: channel.title,
          status: row.status,
        });
      } catch {
        accounts.push({
          id: row.id,
          platform: 'youtube',
          display_name: row.display_name,
          status: 'expired' as AccountRow['status'],
        });
      }
    }
    return { connected: true, accounts };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Real TikTok OAuth routes (PKCE-based)
  // ──────────────────────────────────────────────────────────────────────────
  if (deps.tiktok) {
    const tiktok = deps.tiktok; // Type guard for TypeScript

    app.get('/auth/tiktok/start', async (req, reply) => {
      const state = randomBytes(16).toString('hex');
      const { verifier, challenge } = generatePKCE();

      reply.setCookie('oauth_state', state, {
        path: '/auth',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
      reply.setCookie('tiktok_code_verifier', verifier, {
        path: '/auth',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });

      const popupMode = readPopupQuery(req);
      if (popupMode) {
        reply.setCookie(POPUP_COOKIE, '1', {
          path: '/auth',
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 600,
        });
      }

      return reply.redirect(tiktok.buildAuthUrl(state, challenge));
    });

    app.get('/auth/tiktok/callback', { preHandler: deps.optionalAuthMiddleware }, async (req, reply) => {
      const { code, state, error } = req.query as Record<string, string | undefined>;
      const popupMode = readPopupCookie(req);
      if (popupMode) reply.clearCookie(POPUP_COOKIE, { path: '/auth' });

      const userId = getUserId(req);

      if (error) {
        const webRedirect = `${deps.webOrigin}/accounts?error=${encodeURIComponent(error)}`;
        return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error }));
      }

      if (!code || !state) {
        return reply.code(400).send({ error: 'missing code or state' });
      }

      const cookieState = req.cookies['oauth_state'];
      if (!cookieState || cookieState !== state) {
        return reply.code(400).send({ error: 'state mismatch' });
      }
      reply.clearCookie('oauth_state', { path: '/auth' });

      const verifier = req.cookies['tiktok_code_verifier'];
      if (!verifier) {
        return reply.code(400).send({ error: 'missing code_verifier cookie' });
      }
      reply.clearCookie('tiktok_code_verifier', { path: '/auth' });

      const tokens = await tiktok.exchangeCode(code, verifier);
      req.log.info({ has_refresh: !!tokens.refresh_token, has_access: !!tokens.access_token }, 'tiktok token exchange');

      const user = await tiktok.getMyUser(tokens.access_token);

      const encryptedRefresh = encrypt(tokens.refresh_token, deps.tokenEncryptionKey);
      const encryptedAccess = encrypt(tokens.access_token, deps.tokenEncryptionKey);

      const existing = deps.accounts.findByPlatformExternal('tiktok', user.open_id);
      let accountId: string;
      if (existing) {
        deps.accounts.updateDisplayName(existing.id, user.display_name);
        deps.accounts.updateStatus(existing.id, 'active');
        deps.accounts.updateTokens(existing.id, {
          access_token: encryptedAccess,
          expires_at: tokens.expires_at,
        });
        accountId = existing.id;
      } else {
        const row = deps.accounts.insert({
          user_id: userId,
          platform: 'tiktok',
          external_id: user.open_id,
          display_name: user.display_name,
          oauth_refresh_token: encryptedRefresh,
          oauth_access_token: encryptedAccess,
          token_expires_at: tokens.expires_at,
          status: 'active',
        });
        accountId = row.id;
      }

      const webRedirect = `${deps.webOrigin}/accounts?connected=tiktok&account=${accountId}`;
      return reply.redirect(
        buildAuthRedirect(popupMode, webRedirect, {
          connected: 'tiktok',
          account_id: accountId,
        }),
      );
    });

    app.get('/auth/tiktok/status', async () => {
      const rows = deps.accounts.listByPlatform('tiktok');
      if (rows.length === 0) return { connected: false, accounts: [] };
      const accounts: Array<{
        id: string;
        platform: 'tiktok';
        display_name: string;
        status: AccountRow['status'];
      }> = [];
      for (const row of rows) {
        if (row.status !== 'active') {
          accounts.push({
            id: row.id,
            platform: 'tiktok',
            display_name: row.display_name,
            status: row.status,
          });
          continue;
        }
        let decryptedAccess: string | null = null;
        try {
          decryptedAccess = row.oauth_access_token
            ? decrypt(row.oauth_access_token, deps.tokenEncryptionKey)
            : null;
        } catch {
          accounts.push({
            id: row.id,
            platform: 'tiktok',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
          continue;
        }
        if (!decryptedAccess) {
          accounts.push({
            id: row.id,
            platform: 'tiktok',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
          continue;
        }
        try {
          const user = await tiktok.getMyUser(decryptedAccess);
          accounts.push({
            id: row.id,
            platform: 'tiktok',
            display_name: user.display_name,
            status: row.status,
          });
        } catch {
          accounts.push({
            id: row.id,
            platform: 'tiktok',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
        }
      }
      return { connected: true, accounts };
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Real Meta OAuth routes (Instagram + Facebook with page selection)
  // ──────────────────────────────────────────────────────────────────────────
  if (deps.meta) {
    const meta = deps.meta; // Type guard for TypeScript

    app.get('/auth/meta/start', async (req, reply) => {
      const state = randomBytes(16).toString('hex');
      reply.setCookie('oauth_state', state, {
        path: '/auth',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });

      const popupMode = readPopupQuery(req);
      if (popupMode) {
        reply.setCookie(POPUP_COOKIE, '1', {
          path: '/auth',
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 600,
        });
      }

      return reply.redirect(meta.buildAuthUrl(state));
    });

    app.get('/auth/meta/callback', { preHandler: deps.optionalAuthMiddleware }, async (req, reply) => {
      const { code, state, error } = req.query as Record<string, string | undefined>;
      const popupMode = readPopupCookie(req);
      if (popupMode) reply.clearCookie(POPUP_COOKIE, { path: '/auth' });

      const userId = getUserId(req);

      if (error) {
        const webRedirect = `${deps.webOrigin}/accounts?error=${encodeURIComponent(error)}`;
        return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error }));
      }

      if (!code || !state) {
        return reply.code(400).send({ error: 'missing code or state' });
      }

      const cookieState = req.cookies['oauth_state'];
      if (!cookieState || cookieState !== state) {
        return reply.code(400).send({ error: 'state mismatch' });
      }
      reply.clearCookie('oauth_state', { path: '/auth' });

      const tokens = await meta.exchangeCode(code);
      req.log.info({ has_access: !!tokens.access_token }, 'meta token exchange');

      // Use long-lived token if available, otherwise short-lived
      const accessToken = tokens.long_lived_token ?? tokens.access_token;

      // Get user's pages
      const pages = await meta.listMyPages(accessToken);

      // For each page, create separate account entries
      const connectedAccounts: Array<{ platform: string; account_id: string }> = [];
      for (const page of pages) {
        const platform = page.instagram_username ? 'instagram' : 'facebook';
        const encryptedAccess = encrypt(page.access_token, deps.tokenEncryptionKey);
        const encryptedRefresh = encrypt(`meta-refresh-${page.id}`, deps.tokenEncryptionKey);

        const existing = deps.accounts.findByPlatformExternal(platform, page.id);
        let accountId: string;
        if (existing) {
          deps.accounts.updateDisplayName(existing.id, page.name);
          deps.accounts.updateStatus(existing.id, 'active');
          deps.accounts.updateTokens(existing.id, {
            access_token: encryptedAccess,
            expires_at: tokens.expires_at ?? null,
          });
          accountId = existing.id;
        } else {
          const row = deps.accounts.insert({
            user_id: userId,
            platform,
            external_id: page.id,
            display_name: page.name,
            oauth_refresh_token: encryptedRefresh,
            oauth_access_token: encryptedAccess,
            token_expires_at: tokens.expires_at ?? null,
            status: 'active',
          });
          accountId = row.id;
        }
        connectedAccounts.push({ platform, account_id: accountId });
      }

      const webRedirect = `${deps.webOrigin}/accounts?connected=meta&accounts=${connectedAccounts.map((a) => a.account_id).join(',')}`;
      return reply.redirect(
        buildAuthRedirect(popupMode, webRedirect, {
          connected: 'meta',
          accounts: connectedAccounts,
        }),
      );
    });

    app.get('/auth/instagram/status', async () => {
      const rows = deps.accounts.listByPlatform('instagram');
      if (rows.length === 0) return { connected: false, accounts: [] };
      const accounts: Array<{
        id: string;
        platform: 'instagram';
        display_name: string;
        status: AccountRow['status'];
      }> = [];
      for (const row of rows) {
        if (row.status !== 'active') {
          accounts.push({
            id: row.id,
            platform: 'instagram',
            display_name: row.display_name,
            status: row.status,
          });
          continue;
        }
        let decryptedAccess: string | null = null;
        try {
          decryptedAccess = row.oauth_access_token
            ? decrypt(row.oauth_access_token, deps.tokenEncryptionKey)
            : null;
        } catch {
          accounts.push({
            id: row.id,
            platform: 'instagram',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
          continue;
        }
        if (!decryptedAccess) {
          accounts.push({
            id: row.id,
            platform: 'instagram',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
          continue;
        }
        // For Instagram, we just check if the token decrypts successfully
        // Actual API call would require Instagram Graph API
        accounts.push({
          id: row.id,
          platform: 'instagram',
          display_name: row.display_name,
          status: row.status,
        });
      }
      return { connected: true, accounts };
    });

    app.get('/auth/facebook/status', async () => {
      const rows = deps.accounts.listByPlatform('facebook');
      if (rows.length === 0) return { connected: false, accounts: [] };
      const accounts: Array<{
        id: string;
        platform: 'facebook';
        display_name: string;
        status: AccountRow['status'];
      }> = [];
      for (const row of rows) {
        if (row.status !== 'active') {
          accounts.push({
            id: row.id,
            platform: 'facebook',
            display_name: row.display_name,
            status: row.status,
          });
          continue;
        }
        let decryptedAccess: string | null = null;
        try {
          decryptedAccess = row.oauth_access_token
            ? decrypt(row.oauth_access_token, deps.tokenEncryptionKey)
            : null;
        } catch {
          accounts.push({
            id: row.id,
            platform: 'facebook',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
          continue;
        }
        if (!decryptedAccess) {
          accounts.push({
            id: row.id,
            platform: 'facebook',
            display_name: row.display_name,
            status: 'expired' as AccountRow['status'],
          });
          continue;
        }
        // For Facebook, we just check if the token decrypts successfully
        // Actual API call would require Facebook Graph API
        accounts.push({
          id: row.id,
          platform: 'facebook',
          display_name: row.display_name,
          status: row.status,
        });
      }
      return { connected: true, accounts };
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mock-only OAuth routes for Instagram / Facebook (Phase 2 T2.3).
  //
  // Real flows require per-platform app credentials + review. The mock path
  // lets the simulator exercise the full connect → schedule → publish path
  // without hitting a real OAuth provider. Only mounted when `deps.useMock` is
  // true (matches `USE_MOCK_GOOGLE` / `USE_MOCK_PUBLISHERS`).
  //
  // Token prefix mapping (matches worker stubUpload validators):
  //   instagram  → mock-ig-
  //   facebook   → mock-fb-
  // See BUG-P2-001 in plans/core/phase-2-multi-platform/fix-bugs.md.
  // ──────────────────────────────────────────────────────────────────────────
  const MOCK_PLATFORMS = [
    ...(deps.useMockPublishers ? (['instagram', 'facebook'] as const) : []),
    // The real TikTok OAuth routes above only mount when credentials
    // exist (deps.tiktok). mockTiktok (set when credentials are missing)
    // gives the SPA's "Add TikTok account" button a working mock pair
    // instead of a 404.
    ...(deps.mockTiktok ? (['tiktok'] as const) : []),
  ] as const;
  type MockPlatform = (typeof MOCK_PLATFORMS)[number];
  if (MOCK_PLATFORMS.length === 0) return;

  const MOCK_TOKEN_PREFIX: Record<MockPlatform, string> = {
    instagram: 'mock-ig-',
    facebook: 'mock-fb-',
    tiktok: 'mock-tt-',
  };

  for (const platform of MOCK_PLATFORMS) {
    app.get(`/auth/${platform}/start`, async (req, reply) => {
      // Mock mode skips the OAuth provider hop — we still respect popup
      // mode so the SPA doesn't reload after a "Connect Instagram/FB".
      const popupMode = readPopupQuery(req);
      if (popupMode) {
        reply.setCookie(POPUP_COOKIE, '1', {
          path: '/auth',
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 600,
        });
      }
      const code = `${platform}-${randomBytes(8).toString('hex')}`;
      return reply.redirect(`/auth/${platform}/callback?code=${code}`);
    });
    // 2 / Phase 3 and the regression test asserted the wrong thing. See
    app.get(`/auth/${platform}/callback`, { preHandler: deps.optionalAuthMiddleware }, async (req, reply) => {
      const { code, error } = req.query as Record<string, string | undefined>;
      const popupMode = readPopupCookie(req);
      if (popupMode) reply.clearCookie(POPUP_COOKIE, { path: '/auth' });
      if (error) {
        const webRedirect = `${deps.webOrigin}/accounts?error=${encodeURIComponent(error)}`;
        return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error }));
      }
      if (!code) {
        return reply.code(400).send({ error: 'missing code' });
      }

      const userId = getUserId(req);
      const accessToken = `${MOCK_TOKEN_PREFIX[platform]}${code}`;
      const encryptedAccess = encrypt(accessToken, deps.tokenEncryptionKey);
      const encryptedRefresh = encrypt(`mock-refresh-${code}`, deps.tokenEncryptionKey);

      const displayName = `${platform} account ${code}`;
      const existing = deps.accounts.findByPlatformExternal(platform, code);
      let accountId: string;
      if (existing) {
        deps.accounts.updateDisplayName(existing.id, displayName);
        deps.accounts.updateStatus(existing.id, 'active');
        deps.accounts.updateTokens(existing.id, {
          access_token: encryptedAccess,
          expires_at: Date.now() + 3600_000,
        });
        accountId = existing.id;
      } else {
        const row = deps.accounts.insert({
          user_id: userId,
          platform,
          external_id: code,
          display_name: displayName,
          oauth_refresh_token: encryptedRefresh,
          oauth_access_token: encryptedAccess,
          token_expires_at: Date.now() + 3600_000,
          status: 'active',
        });
        accountId = row.id;
      }

      const webRedirect = `${deps.webOrigin}/accounts?connected=${platform}&account=${accountId}`;
      return reply.redirect(
        buildAuthRedirect(popupMode, webRedirect, {
          connected: platform,
          account_id: accountId,
        }),
      );
    });
  }
}
