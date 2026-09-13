/**
 * Real TikTok OAuth client.
 *
 * Endpoints (TikTok Display API + Login Kit):
 *   - Authorize:  https://www.tiktok.com/v2/auth/authorize/
 *   - Token:      https://open.tiktokapis.com/v2/oauth/token/
 *   - Refresh:    same /v2/oauth/token/ with grant_type=refresh_token
 *   - User info:  https://open.tiktokapis.com/v2/user/info/?fields=...
 *
 * PKCE: the auth URL must include the S256 `code_challenge`; the
 * token exchange must include the original `code_verifier`. Caller is
 * responsible for generating the pair.
 *
 * NOTE: this client never throws on missing credentials at construction —
 * it fails at request time. The factory decides whether to instantiate it
 * (only when `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` are set AND
 * the user has not opted into mock mode).
 */
import type {
  TiktokOAuthClient,
  TiktokTokens,
  TiktokUserInfo,
} from './client.js';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

export interface RealTiktokConfig {
  clientKey: string;
  clientSecret: string;
  /** Must be registered in TikTok dev portal as a redirect URI. */
  redirectUri: string;
  /**
   * Comma/space-separated scopes to request. Default includes the minimum
   * needed for video upload + publish + reading the user's display name.
   */
  scopes?: string;
  /**
   * Optional fetch override for tests. Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_SCOPES = 'user.info.basic,video.upload,video.publish';

/** Translate a snake_case API field into the camelCase our interface uses. */
interface TiktokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
  token_type?: string;
  open_id: string;
}

interface TiktokUserResponse {
  data?: {
    user?: {
      open_id: string;
      display_name?: string;
      avatar_url?: string;
    };
  };
  error?: { code: string; message: string };
}

export function createRealTiktokClient(config: RealTiktokConfig): TiktokOAuthClient {
  const scopes = config.scopes ?? DEFAULT_SCOPES;
  const f = config.fetchImpl ?? fetch;

  function assertOk(res: Response, context: string): void {
    if (!res.ok) {
      // TikTok returns 400 with JSON body for invalid_grant etc.
      throw new Error(
        `tiktok: ${context} failed: HTTP ${res.status} ${res.statusText}`,
      );
    }
  }

  async function parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`tiktok: ${text.slice(0, 200) || '<empty>'}`);
    }
  }

  function parseTokenResponse(body: TiktokTokenResponse, hint: string): TiktokTokens {
    if (!body.access_token) {
      throw new Error(`tiktok: ${hint}: missing access_token in response`);
    }
    if (!body.refresh_token) {
      throw new Error(`tiktok: ${hint}: missing refresh_token in response`);
    }
    if (!body.open_id) {
      throw new Error(`tiktok: ${hint}: missing open_id in response`);
    }
    return {
      access_token: body.access_token,
      // expires_in is seconds since response — convert to ms epoch.
      expires_at: Date.now() + body.expires_in * 1000,
      refresh_token: body.refresh_token,
      scope: body.scope ?? scopes,
      token_type: body.token_type ?? 'Bearer',
      open_id: body.open_id,
    };
  }

  return {
    buildAuthUrl(state, codeChallenge) {
      const u = new URL(AUTHORIZE_URL);
      u.searchParams.set('client_key', config.clientKey);
      u.searchParams.set('scope', scopes);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('redirect_uri', config.redirectUri);
      u.searchParams.set('state', state);
      u.searchParams.set('code_challenge', codeChallenge);
      u.searchParams.set('code_challenge_method', 'S256');
      return u.toString();
    },

    async exchangeCode(code, codeVerifier): Promise<TiktokTokens> {
      if (!codeVerifier) {
        throw new Error('tiktok: codeVerifier is required (PKCE)');
      }
      const body = new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier,
      });
      const res = await f(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      assertOk(res, 'exchangeCode');
      const json = await parseJson<TiktokTokenResponse>(res);
      return parseTokenResponse(json, 'exchangeCode');
    },

    async refresh(refreshToken): Promise<TiktokTokens> {
      const body = new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      const res = await f(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      assertOk(res, 'refresh');
      const json = await parseJson<TiktokTokenResponse>(res);
      return parseTokenResponse(json, 'refresh');
    },

    async getMyUser(accessToken): Promise<TiktokUserInfo> {
      const u = new URL(USER_INFO_URL);
      u.searchParams.set('fields', 'open_id,display_name,avatar_url');
      const res = await f(u.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assertOk(res, 'getMyUser');
      const json = await parseJson<TiktokUserResponse>(res);
      if (json.error) {
        throw new Error(`tiktok: getMyUser: ${json.error.code} ${json.error.message}`);
      }
      const u2 = json.data?.user;
      if (!u2?.open_id) throw new Error('tiktok: getMyUser: no user in response');
      return {
        open_id: u2.open_id,
        display_name: u2.display_name ?? 'TikTok User',
        avatar_url: u2.avatar_url ?? '',
      };
    },
  };
}
