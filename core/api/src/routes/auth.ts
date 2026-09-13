import type { FastifyInstance } from 'fastify';
import { decrypt, encrypt } from '@social-auto/shared/utils/crypto.js';
import type { AccountRow } from '@social-auto/shared';
import { randomBytes } from 'node:crypto';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { GoogleOAuthClient } from '../google/client.js';

export interface AuthDeps {
  accounts: AccountsRepo;
  google: GoogleOAuthClient;
  /** Where to redirect after OAuth callback (web app). */
  webOrigin: string;
  /** Encryption key for token storage. */
  tokenEncryptionKey: string;
  /** Mounts the legacy IG/FB mock OAuth routes. Driven by `USE_MOCK_PUBLISHERS`. */
  useMockPublishers?: boolean;
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

  app.get('/auth/callback', async (req, reply) => {
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
  // Mock-only OAuth routes for TikTok / Instagram / Facebook (Phase 2 T2.2/T2.3).
  //
  // Real flows require per-platform app credentials + review. The mock path
  // lets the simulator exercise the full connect → schedule → publish path
  // without hitting a real OAuth provider. Only mounted when `deps.useMock` is
  // true (matches `USE_MOCK_GOOGLE` / `USE_MOCK_PUBLISHERS`).
  //
  // Token prefix mapping (matches worker stubUpload validators):
  //   tiktok     → mock-tt-
  //   instagram  → mock-ig-
  //   facebook   → mock-fb-
  // See BUG-P2-001 in plans/core/phase-2-multi-platform/fix-bugs.md.
  // ──────────────────────────────────────────────────────────────────────────
  if (!deps.useMockPublishers) return;
  // Mock-only OAuth routes for Instagram + Facebook (Phase 2 T2.3).
  //
  // Real flows require Meta App ID/Secret + app review. The mock path lets
  // the simulator exercise the full connect → schedule → publish path
  // without hitting a real OAuth provider. Only mounted when `deps.useMock`
  // is true (the global `USE_MOCK_GOOGLE` flag also covers these legacy
  // routes — see `meta/authRoutes.ts` for the real Meta implementation).
  //
  // Token prefix mapping (matches worker stubUpload validators):
  //   instagram  → mock-ig-
  //   facebook   → mock-fb-
  // See BUG-P2-001 in plans/core/phase-2-multi-platform/fix-bugs.md.
  // ──────────────────────────────────────────────────────────────────────────

  const MOCK_PLATFORMS = ['instagram', 'facebook'] as const;
  type MockPlatform = (typeof MOCK_PLATFORMS)[number];

  const MOCK_TOKEN_PREFIX: Record<MockPlatform, string> = {
    instagram: 'mock-ig-',
    facebook: 'mock-fb-',
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
    app.get(`/auth/${platform}/callback`, async (req, reply) => {
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
