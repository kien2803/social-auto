/**
 * In-memory mock of the TikTok OAuth client.
 * Same shape as `realClient` so the rest of the codebase never branches on
 * mock vs real — only the factory in `factory.ts` decides which to build.
 */
import { randomBytes } from 'node:crypto';
import type {
  TiktokOAuthClient,
  TiktokTokens,
  TiktokUserInfo,
} from './client.js';

export interface MockTiktokConfig {
  /** Pre-set user to return for `getMyUser`. Defaults to a fake TikTok user. */
  user?: TiktokUserInfo;
  /** Force exchangeCode to throw with this message. */
  failExchange?: string;
  /** Force refresh to throw with this message. */
  failRefresh?: string;
  /** When set, getMyUser throws with this message. */
  failGetUser?: string;
}

const DEFAULT_USER: TiktokUserInfo = {
  open_id: 'mock-tiktok-open-id-1',
  display_name: 'Mock TikTok Creator',
  avatar_url: 'https://example.com/avatar.jpg',
};

export function createMockTiktokClient(cfg: MockTiktokConfig = {}): TiktokOAuthClient {
  const user = cfg.user ?? DEFAULT_USER;
  let tokenCounter = 0;

  return {
    buildAuthUrl(state, codeChallenge) {
      // The mock skips TikTok entirely: redirect straight to the local
      // /auth/tiktok/callback with a synthetic code and the same state +
      // code_challenge the API would have stored. The real client builds
      // the same URL with tiktok.com as the host — both paths converge at
      // /auth/tiktok/callback.
      // Use the configured redirectUri when provided so the mock honors
      // the host the API is actually serving on (e.g. :5182 during
      // parallel-stack dev); fall back to localhost:3000 for tests that
      // don't inject a redirectUri.
      const target = process.env['TIKTOK_REDIRECT_URI'] || 'http://localhost:3000/auth/tiktok/callback';
      const u = new URL(target);
      u.searchParams.set('state', state);
      u.searchParams.set('code', `mock-tt-code-${++tokenCounter}`);
      u.searchParams.set('code_challenge', codeChallenge);
      return u.toString();
    },

    async exchangeCode(code, codeVerifier): Promise<TiktokTokens> {
      if (cfg.failExchange) throw new Error(`mock: ${cfg.failExchange}`);
      if (!codeVerifier) throw new Error('mock: codeVerifier is required (PKCE)');
      tokenCounter += 1;
      return {
        access_token: `mock-tt-access-${tokenCounter}-${code}`,
        // 24h — matches TikTok's documented access token lifetime.
        expires_at: Date.now() + 24 * 3600_000,
        refresh_token: `mock-tt-refresh-${tokenCounter}-${code}`,
        scope: 'user.info.basic,video.upload,video.publish',
        token_type: 'Bearer',
        open_id: user.open_id,
      };
    },

    async refresh(refreshToken): Promise<TiktokTokens> {
      if (cfg.failRefresh) throw new Error(`mock: ${cfg.failRefresh}`);
      return {
        access_token: `mock-tt-access-refreshed-${randomBytes(4).toString('hex')}`,
        expires_at: Date.now() + 24 * 3600_000,
        refresh_token: refreshToken,
        scope: 'user.info.basic,video.upload,video.publish',
        token_type: 'Bearer',
        open_id: user.open_id,
      };
    },

    async getMyUser(accessToken): Promise<TiktokUserInfo> {
      if (cfg.failGetUser) throw new Error(`mock: ${cfg.failGetUser}`);
      if (!accessToken.startsWith('mock-tt-')) {
        throw new Error('mock: invalid access token (not mock-tt- prefix)');
      }
      return user;
    },
  };
}
