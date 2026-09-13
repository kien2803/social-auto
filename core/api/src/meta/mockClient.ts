/**
 * In-memory mock of the Meta (FB + IG) OAuth client.
 *
 * The mock returns a small fixed list of pages + linked IG business
 * accounts so the auth callback has something to insert. Token strings
 * carry a `mock-fb-` / `mock-ig-` prefix that the worker stub validators
 * already accept.
 */
import { randomBytes } from 'node:crypto';
import type {
  MetaOAuthClient,
  MetaTokens,
  MetaUser,
  MetaPage,
} from './client.js';

export interface MockMetaConfig {
  user?: MetaUser;
  pages?: MetaPage[];
  failExchange?: string;
  failRefresh?: string;
  failListPages?: string;
}

const DEFAULT_USER: MetaUser = {
  id: 'mock-fb-user-1',
  name: 'Mock Facebook User',
  picture_url: 'https://example.com/fb-avatar.jpg',
};

const DEFAULT_PAGES: MetaPage[] = [
  {
    id: 'mock-fb-page-1',
    name: 'Mock FB Page',
    access_token: `mock-fb-${randomBytes(4).toString('hex')}`,
    picture_url: 'https://example.com/fb-page.jpg',
    instagram_business_account_id: 'mock-ig-account-1',
    instagram_username: 'mock_ig_creator',
  },
];

export function createMockMetaClient(cfg: MockMetaConfig = {}): MetaOAuthClient {
  const user = cfg.user ?? DEFAULT_USER;
  const pages = cfg.pages ?? DEFAULT_PAGES;
  let tokenCounter = 0;

  return {
    buildAuthUrl(state) {
      // Mock bypasses Facebook — redirect straight to /auth/meta/callback
      // with a synthetic code. Same pattern as the TikTok mock.
      const u = new URL('http://localhost:3000/auth/meta/callback');
      u.searchParams.set('state', state);
      u.searchParams.set('code', `mock-meta-code-${++tokenCounter}`);
      return u.toString();
    },

    async exchangeCode(code): Promise<MetaTokens> {
      if (cfg.failExchange) throw new Error(`mock: ${cfg.failExchange}`);
      tokenCounter += 1;
      return {
        access_token: `mock-fb-short-${tokenCounter}-${code}`,
        // ~60 day long-lived token (real Meta behavior).
        long_lived_token: `mock-fb-long-${tokenCounter}-${code}`,
        expires_at: Date.now() + 60 * 24 * 3600_000,
      };
    },

    async exchangeForLongLivedToken(shortLivedToken): Promise<MetaTokens> {
      return {
        access_token: `mock-fb-long-${randomBytes(4).toString('hex')}-${shortLivedToken.slice(-6)}`,
        expires_at: Date.now() + 60 * 24 * 3600_000,
      };
    },

    async refreshLongLivedToken(longLivedToken): Promise<MetaTokens> {
      if (cfg.failRefresh) throw new Error(`mock: ${cfg.failRefresh}`);
      return {
        access_token: `mock-fb-refreshed-${randomBytes(4).toString('hex')}-${longLivedToken.slice(-6)}`,
        expires_at: Date.now() + 60 * 24 * 3600_000,
      };
    },

    async getMyUser(accessToken): Promise<MetaUser> {
      if (!accessToken.startsWith('mock-fb-') && !accessToken.startsWith('mock-ig-')) {
        throw new Error('mock: invalid access token (not mock-fb-/ig- prefix)');
      }
      return user;
    },

    async listMyPages(accessToken): Promise<MetaPage[]> {
      if (cfg.failListPages) throw new Error(`mock: ${cfg.failListPages}`);
      if (!accessToken.startsWith('mock-fb-') && !accessToken.startsWith('mock-ig-')) {
        throw new Error('mock: invalid access token');
      }
      return pages;
    },
  };
}
