/**
 * TikTok OAuth routes (PKCE).
 *
 *   GET /auth/tiktok/start
 *     Generates a random `state` and a PKCE S256 verifier/challenge pair,
 *     stashes both in short-lived cookies, and 302-redirects the browser to
 *     the configured TikTok authorize URL.
 *
 *   GET /auth/tiktok/callback
 *     Verifies the `state` cookie matches the query, exchanges `code` for
 *     tokens, fetches the user's TikTok profile, encrypts the refresh +
 *     access tokens, and upserts the accounts table.
 *
 * The two-cookie design (state + PKCE verifier) is what the TikTok spec
 * actually requires for a public client. Without the verifier cookie, the
 * token exchange returns `invalid_grant`.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { encrypt } from '@social-auto/shared/utils/crypto.js';
import type { TiktokOAuthClient } from './client.js';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { AccountRow } from '@social-auto/shared';
import { getUserId } from '../utils/authHelpers.js';

export interface TiktokAuthDeps {
  accounts: AccountsRepo;
  tiktok: TiktokOAuthClient;
  webOrigin: string;
  tokenEncryptionKey: string;
  optionalAuthMiddleware?: (request: any, reply: any) => Promise<void>;
}

/** Generate a 43-character URL-safe PKCE verifier + its S256 challenge. */
function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

import {
  POPUP_COOKIE,
  POPUP_QUERY,
  buildAuthRedirect,
  clearOrphanOAuthCookies,
} from '../auth/popupClose.js';

export function registerTiktokAuthRoutes(app: FastifyInstance, deps: TiktokAuthDeps): void {
  // Wipe oauth_state / oauth_popup / oauth_pkce_verifier on any 4xx/5xx
  // so a failed TikTok OAuth round-trip never leaves a stale cookie on
  // the browser.
  clearOrphanOAuthCookies(app);

  /** Read the popup-mode opt-in from the inbound request's query string. */
  function readPopupQuery(req: { query: unknown }): boolean {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const raw = q[POPUP_QUERY];
    return raw === '1' || raw === 'true';
  }

  app.get('/auth/tiktok/start', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    const { verifier, challenge } = makePkce();
    const cookieOpts = {
      path: '/auth',
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 600,
    };
    reply.setCookie('oauth_state', state, cookieOpts);
    reply.setCookie('oauth_pkce_verifier', verifier, cookieOpts);
    // Popup-mode opt-in: SPA appends ?popup=1 when opening a child window.
    // The cookie survives the OAuth round-trip on the popup window so the
    // callback can redirect to /auth/popup-close instead of /accounts?...
    const popupMode = readPopupQuery(req);
    if (popupMode) {
      reply.setCookie(POPUP_COOKIE, '1', cookieOpts);
    }
    return reply.redirect(deps.tiktok.buildAuthUrl(state, challenge));
  });

  // Wipe oauth_state / oauth_popup / oauth_pkce_verifier on any 4xx/5xx

  app.get('/auth/tiktok/callback', { preHandler: deps.optionalAuthMiddleware }, async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const popupMode = req.cookies[POPUP_COOKIE] === '1';
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
    const verifier = req.cookies['oauth_pkce_verifier'];
    if (!cookieState || cookieState !== state) {
      return reply.code(400).send({ error: 'state mismatch' });
    }
    if (!verifier) {
      return reply.code(400).send({ error: 'pkce_verifier missing — restart /auth/tiktok/start' });
    }
    reply.clearCookie('oauth_state', { path: '/auth' });
    reply.clearCookie('oauth_pkce_verifier', { path: '/auth' });

    const tokens = await deps.tiktok.exchangeCode(code, verifier);
    const user = await deps.tiktok.getMyUser(tokens.access_token);

    const encryptedRefresh = encrypt(tokens.refresh_token, deps.tokenEncryptionKey);
    const encryptedAccess = encrypt(tokens.access_token, deps.tokenEncryptionKey);

    // Identify accounts by TikTok's stable open_id. Same id → reconnect,
    // different id → new row (single TikTok account per install is the
    // Phase 0 constraint; Phase 2 lifted it for YouTube already).
    const existing = deps.accounts.findByPlatformExternal('tiktok', user.open_id);
    let accountId: string;
    if (existing) {
      if (existing.user_id !== userId) deps.accounts.reassignOwner(existing.id, userId);
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
        channel: {
          avatar_url: user.avatar_url,
        },
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

  // TikTok status endpoint (simplified - just returns account status without API validation)
  app.get('/auth/tiktok/status', async () => {
    const rows = deps.accounts.listByPlatform('tiktok');
    if (rows.length === 0) return { connected: false, accounts: [] };
    
    const accounts: Array<{
      id: string;
      platform: 'tiktok';
      display_name: string;
      status: AccountRow['status'];
    }> = rows.map(row => ({
      id: row.id,
      platform: 'tiktok',
      display_name: row.display_name,
      status: row.status,
    }));
    
    return { connected: true, accounts };
  });
}
