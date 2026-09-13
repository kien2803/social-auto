/**
 * Real Meta (Facebook) OAuth + Graph API client.
 *
 * Endpoints:
 *   - Authorize:  https://www.facebook.com/{API_VERSION}/dialog/oauth
 *   - Token:      https://graph.facebook.com/{API_VERSION}/oauth/access_token
 *   - Long-lived: https://graph.facebook.com/{API_VERSION}/oauth/access_token?grant_type=fb_exchange_token
 *   - Refresh:    https://graph.facebook.com/{API_VERSION}/oauth/access_token?grant_type=fb_exchange_token
 *                 (same call, called on a long-lived token)
 *   - /me:        https://graph.facebook.com/{API_VERSION}/me
 *   - /me/accounts: https://graph.facebook.com/{API_VERSION}/me/accounts?fields=...
 *
 * Required app review scopes for IG Reels + FB Page posts:
 *   pages_show_list, pages_manage_posts, instagram_basic, instagram_content_publish
 *
 * The real flow needs:
 *   1. /auth/meta/start → redirect to FB dialog with the scopes above.
 *   2. /auth/meta/callback → exchange code → exchange for long-lived →
 *      /me/accounts → user picks which Page(s) to connect → we insert
 *      one row per picked Page (FB) and per linked IG business account.
 */
import type {
  MetaOAuthClient,
  MetaTokens,
  MetaUser,
  MetaPage,
} from './client.js';

const DEFAULT_SCOPES = [
  'public_profile',
  'email',
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
].join(',');

export interface RealMetaConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiVersion?: string;
  scopes?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface UserResponse {
  id: string;
  name?: string;
  picture?: { data?: { url?: string } };
}

interface AccountsResponse {
  data?: Array<{
    id: string;
    name?: string;
    access_token?: string;
    picture?: { data?: { url?: string } };
    instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
  }>;
}

export function createRealMetaClient(config: RealMetaConfig): MetaOAuthClient {
  const apiVersion = config.apiVersion ?? 'v24.0';
  const scopes = config.scopes ?? DEFAULT_SCOPES;
  const f = config.fetchImpl ?? fetch;

  function dialogUrl(): string {
    return `https://www.facebook.com/${apiVersion}/dialog/oauth`;
  }
  function graphUrl(path: string, params: Record<string, string>): string {
    const u = new URL(`https://graph.facebook.com/${apiVersion}${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  function parseToken(body: TokenResponse, hint: string): MetaTokens {
    if (!body.access_token) {
      throw new Error(`meta: ${hint}: missing access_token in response`);
    }
    return {
      access_token: body.access_token,
      expires_at:
        typeof body.expires_in === 'number'
          ? Date.now() + body.expires_in * 1000
          : undefined,
    };
  }

  return {
    buildAuthUrl(state) {
      const u = new URL(dialogUrl());
      u.searchParams.set('client_id', config.appId);
      u.searchParams.set('redirect_uri', config.redirectUri);
      u.searchParams.set('state', state);
      u.searchParams.set('scope', scopes);
      u.searchParams.set('response_type', 'code');
      return u.toString();
    },

    async exchangeCode(code): Promise<MetaTokens> {
      const res = await f(
        graphUrl('/oauth/access_token', {
          client_id: config.appId,
          client_secret: config.appSecret,
          redirect_uri: config.redirectUri,
          code,
        }),
        { method: 'GET' },
      );
      if (!res.ok) {
        // Don't leak the Graph API response body — it can contain
        // app-level error details / partial tokens in test-mode
        // callbacks. The status code + the next parseToken() call
        // (which has its own message) give the operator enough to
        // debug from the server logs.
        throw new Error(`meta: exchangeCode failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as TokenResponse;
      const tokens = parseToken(body, 'exchangeCode');
      // Best-effort: also exchange for a long-lived token. If this fails
      // (e.g. test mode) we still return the short-lived pair; the worker
      // will just see a shorter expiry.
      try {
        const ll = await this.exchangeForLongLivedToken(tokens.access_token);
        return { ...tokens, long_lived_token: ll.access_token, expires_at: ll.expires_at };
      } catch {
        return tokens;
      }
    },

    async exchangeForLongLivedToken(shortLivedToken): Promise<MetaTokens> {
      const res = await f(
        graphUrl('/oauth/access_token', {
          grant_type: 'fb_exchange_token',
          client_id: config.appId,
          client_secret: config.appSecret,
          fb_exchange_token: shortLivedToken,
        }),
        { method: 'GET' },
      );
      if (!res.ok) {
        // Don't leak the response body (see exchangeCode for rationale).
        throw new Error(`meta: long-lived exchange failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as TokenResponse;
      return parseToken(body, 'exchangeForLongLivedToken');
    },

    async refreshLongLivedToken(longLivedToken): Promise<MetaTokens> {
      // Same endpoint as the long-lived exchange — Meta calls it a
      // "refresh" but the params are identical to fb_exchange_token.
      return this.exchangeForLongLivedToken(longLivedToken);
    },

    async getMyUser(accessToken): Promise<MetaUser> {
      const res = await f(
        graphUrl('/me', { access_token: accessToken, fields: 'id,name,picture' }),
        { method: 'GET' },
      );
      if (!res.ok) {
        // Don't leak the response body (see exchangeCode for rationale).
        throw new Error(`meta: getMyUser failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as UserResponse;
      return {
        id: body.id,
        name: body.name ?? 'Facebook User',
        picture_url: body.picture?.data?.url,
      };
    },

    async listMyPages(accessToken): Promise<MetaPage[]> {
      const res = await f(
        graphUrl('/me/accounts', {
          access_token: accessToken,
          fields:
            'id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url}',
        }),
        { method: 'GET' },
      );
      if (!res.ok) {
        // Don't leak the response body (see exchangeCode for rationale).
        throw new Error(`meta: listMyPages failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as AccountsResponse;
      const list = body.data ?? [];
      return list.flatMap((p): MetaPage[] => {
        if (!p.id || !p.access_token) return [];
        const out: MetaPage[] = [
          {
            id: p.id,
            name: p.name ?? p.id,
            access_token: p.access_token,
            picture_url: p.picture?.data?.url,
          },
        ];
        if (p.instagram_business_account?.id) {
          out.push({
            id: p.instagram_business_account.id,
            name: p.instagram_business_account.username
              ? `@${p.instagram_business_account.username}`
              : p.instagram_business_account.id,
            access_token: p.access_token,
            // The IG account's own avatar — not the linked Facebook Page's
            // picture. Requesting `profile_picture_url` from the Graph API
            // (see the `fields` param above) means the IG row carries its
            // own avatar instead of inheriting the Page's.
            picture_url: p.instagram_business_account.profile_picture_url ?? p.picture?.data?.url,
            instagram_username: p.instagram_business_account.username,
          });
        }
        return out;
      });
    },
  };
}
