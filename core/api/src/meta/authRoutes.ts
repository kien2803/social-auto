/**
 * Meta (Facebook + Instagram) OAuth routes.
 *
 *   GET /auth/meta/start
 *     Generates a random `state`, stashes it in a short-lived cookie, and
 *     302-redirects the browser to the Facebook dialog with the configured
 *     scopes.
 *
 *   GET /auth/meta/callback
 *     Exchanges `code` for short-lived + long-lived tokens, fetches the
 *     user's Pages + linked IG business accounts, and inserts one account
 *     row per (platform, page-or-ig-id) pair. The user is redirected to
 *     /accounts with `connected=facebook,instagram` so the UI can refresh.
 *
 * No PKCE — Meta's public-client flow is the standard authorization code
 * grant; the long-lived user token (60 days) is the durable secret. Each
 * Page's access token is the credential the worker uses to publish.
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { encrypt } from '@social-auto/shared/utils/crypto.js';
import type { MetaOAuthClient } from './client.js';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { AccountRow } from '@social-auto/shared';
import {
  POPUP_COOKIE,
  POPUP_QUERY,
  buildAuthRedirect,
  clearOrphanOAuthCookies,
} from '../auth/popupClose.js';
import { getUserId } from '../utils/authHelpers.js';

export interface MetaAuthDeps {
  accounts: AccountsRepo;
  meta: MetaOAuthClient;
  webOrigin: string;
  tokenEncryptionKey: string;
  optionalAuthMiddleware?: (request: any, reply: any) => Promise<void>;
}
export function registerMetaAuthRoutes(app: FastifyInstance, deps: MetaAuthDeps): void {
  // Wipe oauth_state / oauth_popup on any 4xx/5xx so a failed Meta
  // OAuth round-trip never leaves a stale cookie on the browser.
  clearOrphanOAuthCookies(app);

  /** Read the popup-mode opt-in from the inbound request's query string. */
  function readPopupQuery(req: { query: unknown }): boolean {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const raw = q[POPUP_QUERY];
    return raw === '1' || raw === 'true';
  }

  app.get('/auth/meta/start', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    reply.setCookie('oauth_state', state, {
      path: '/auth',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    // Popup-mode opt-in for SPA.
    const popupMode = readPopupQuery(req);
    if (popupMode) {
      reply.setCookie(POPUP_COOKIE, '1', {
        path: '/auth',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
    }
    return reply.redirect(deps.meta.buildAuthUrl(state));
  });

  // Wipe oauth_state / oauth_popup on any 4xx/5xx so a failed Meta

  app.get('/auth/meta/callback', { preHandler: deps.optionalAuthMiddleware }, async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const popupMode = req.cookies[POPUP_COOKIE] === '1';
    if (popupMode) reply.clearCookie(POPUP_COOKIE, { path: '/auth' });

    const userId = getUserId(req);

    if (error) {
      const webRedirect = `${deps.webOrigin}/accounts?error=${encodeURIComponent(error)}`;
      return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error }));
    }
    // Session can expire mid-OAuth — without this, userId: undefined would
    // reach reassignOwner/insert as a runtime-only type hole.
    if (!userId) {
      const webRedirect = `${deps.webOrigin}/accounts?error=session_expired`;
      return reply.redirect(buildAuthRedirect(popupMode, webRedirect, { error: 'session_expired' }));
    }
    if (!code || !state) {
      return reply.code(400).send({ error: 'missing code or state' });
    }
    const cookieState = req.cookies['oauth_state'];
    if (!cookieState || cookieState !== state) {
      return reply.code(400).send({ error: 'state mismatch' });
    }
    reply.clearCookie('oauth_state', { path: '/auth' });

    const tokens = await deps.meta.exchangeCode(code);
    const durable = tokens.long_lived_token ?? tokens.access_token;
    const pages = await deps.meta.listMyPages(durable);

    const encryptedAccess = encrypt(durable, deps.tokenEncryptionKey);
    const encryptedRefresh = encrypt(durable, deps.tokenEncryptionKey);

    type Row = { platform: 'facebook' | 'instagram'; externalId: string; displayName: string };
    const rows: Row[] = [];
    for (const p of pages) {
      rows.push({ platform: 'facebook', externalId: p.id, displayName: p.name });
      if (p.instagram_business_account_id) {
        rows.push({
          platform: 'instagram',
          externalId: p.instagram_business_account_id,
          displayName: p.instagram_username
            ? `@${p.instagram_username}`
            : p.instagram_business_account_id,
        });
      }
    }
    const insertedIds: string[] = [];
    for (const r of rows) {
      // Per-row avatar: pick the matching page OR IG entry. The mock
      // client emits one Page per (platform==='facebook') plus one IG
      // per linked account, each carrying its own picture_url. The
      // earlier implementation collapsed both via pages.find() and
      // always returned the FB Page's picture for the IG row; here
      // we look up by exact id first, then by the IG-business-account
      // link as a fallback.
      const matchingPage =
        pages.find((p) => p.id === r.externalId) ??
        pages.find((p) => p.instagram_business_account_id === r.externalId);
      const avatarUrl = matchingPage?.picture_url;
      const existing = deps.accounts.findByPlatformExternal(r.platform, r.externalId);
      if (existing) {
        if (existing.user_id !== userId) deps.accounts.reassignOwner(existing.id, userId);
        deps.accounts.updateDisplayName(existing.id, r.displayName ?? existing.display_name ?? 'Account');
        deps.accounts.updateStatus(existing.id, 'active');
        deps.accounts.updateTokens(existing.id, {
          access_token: encryptedAccess,
          expires_at: tokens.expires_at ?? null,
        });
        if (avatarUrl) deps.accounts.updateChannelSnapshot(existing.id, { avatar_url: avatarUrl });
        insertedIds.push(existing.id);
        continue;
      }
      const row = deps.accounts.insert({
        user_id: userId,
        platform: r.platform,
        external_id: r.externalId,
        display_name: r.displayName,
        oauth_refresh_token: encryptedRefresh,
        oauth_access_token: encryptedAccess,
        token_expires_at: tokens.expires_at ?? null,
        status: 'active',
        channel: avatarUrl ? { avatar_url: avatarUrl } : undefined,
      });
      insertedIds.push(row.id);
    }

    const webRedirect = `${deps.webOrigin}/accounts?connected=meta&accounts=${insertedIds.join(',')}`;
    return reply.redirect(
      buildAuthRedirect(popupMode, webRedirect, {
        connected: 'meta',
        account_ids: insertedIds,
      }),
    );
  });

  // Instagram status endpoint (simplified - just returns account status without API validation)
  app.get('/auth/instagram/status', async () => {
    const rows = deps.accounts.listByPlatform('instagram');
    if (rows.length === 0) return { connected: false, accounts: [] };
    
    const accounts: Array<{
      id: string;
      platform: 'instagram';
      display_name: string;
      status: AccountRow['status'];
    }> = rows.map(row => ({
      id: row.id,
      platform: 'instagram',
      display_name: row.display_name,
      status: row.status,
    }));
    
    return { connected: true, accounts };
  });

  // Facebook status endpoint (simplified - just returns account status without API validation)
  app.get('/auth/facebook/status', async () => {
    const rows = deps.accounts.listByPlatform('facebook');
    if (rows.length === 0) return { connected: false, accounts: [] };
    
    const accounts: Array<{
      id: string;
      platform: 'facebook';
      display_name: string;
      status: AccountRow['status'];
    }> = rows.map(row => ({
      id: row.id,
      platform: 'facebook',
      display_name: row.display_name,
      status: row.status,
    }));
    
    return { connected: true, accounts };
  });
}
