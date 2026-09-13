import { describe, it, expect } from 'vitest';
import { createRealMetaClient } from './realClient.js';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface MockFetch extends Pick<typeof globalThis, 'fetch'> {
  calls(): FetchCall[];
}

function mockFetch(responses: Array<{ status?: number; body: unknown }>): MockFetch {
  const calls: FetchCall[] = [];
  let i = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const next = responses[i] ?? responses[responses.length - 1];
    if (!next) throw new Error(`mockFetch: no response queued for call #${i + 1} ${url}`);
    i += 1;
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(body, {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Object.assign(impl, { calls: () => calls }) as unknown as MockFetch;
}

const DEFAULT_CONFIG = {
  appId: 'app-id',
  appSecret: 'app-secret',
  redirectUri: 'http://localhost:3000/auth/meta/callback',
  apiVersion: 'v24.0',
};

describe('createRealMetaClient.buildAuthUrl', () => {
  it('builds a Facebook dialog URL with state + scopes', () => {
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: mockFetch([]) as unknown as typeof fetch });
    const url = new URL(c.buildAuthUrl('state-1'));
    expect(url.host).toBe('www.facebook.com');
    expect(url.pathname).toBe('/v24.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('app-id');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
  });
});

describe('createRealMetaClient.exchangeCode → long-lived exchange', () => {
  it('exchanges code for short-lived token, then for long-lived; final pair returned', async () => {
    const f = mockFetch([
      // 1) short-lived
      { body: { access_token: 'short-at', token_type: 'bearer', expires_in: 7200 } },
      // 2) long-lived
      { body: { access_token: 'long-at', token_type: 'bearer', expires_in: 5_184_000 } },
    ]);
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: f as unknown as typeof fetch });
    const tokens = await c.exchangeCode('code-1');

    expect(tokens.access_token).toBe('short-at');
    expect(tokens.long_lived_token).toBe('long-at');

    const calls = f.calls();
    // 1st call: code → short-lived
    expect(calls[0]?.url).toContain('/v24.0/oauth/access_token');
    expect(calls[0]?.url).toContain('code=code-1');
    expect(calls[0]?.url).toContain('client_id=app-id');
    expect(calls[0]?.url).toContain('client_secret=app-secret');
    // 2nd call: short-lived → long-lived via grant_type=fb_exchange_token
    expect(calls[1]?.url).toContain('grant_type=fb_exchange_token');
    expect(calls[1]?.url).toContain('fb_exchange_token=short-at');
  });

  it('returns the short-lived token when the long-lived exchange fails', async () => {
    const f = mockFetch([
      { body: { access_token: 'short-at', expires_in: 3600 } },
      { status: 400, body: { error: { message: 'bad short token' } } },
    ]);
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: f as unknown as typeof fetch });
    const tokens = await c.exchangeCode('code-1');
    expect(tokens.access_token).toBe('short-at');
    expect(tokens.long_lived_token).toBeUndefined();
  });
});

describe('createRealMetaClient.getMyUser', () => {
  it('returns the user profile', async () => {
    const f = mockFetch([
      {
        body: {
          id: 'fb-user-1',
          name: 'FB Creator',
          picture: { data: { url: 'https://example.com/avatar.jpg' } },
        },
      },
    ]);
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: f as unknown as typeof fetch });
    const user = await c.getMyUser('long-at');
    expect(user.id).toBe('fb-user-1');
    expect(user.name).toBe('FB Creator');
    expect(user.picture_url).toBe('https://example.com/avatar.jpg');
  });
});

describe('createRealMetaClient.listMyPages', () => {
  it('flattens /me/accounts into Page rows + linked IG business accounts', async () => {
    const f = mockFetch([
      {
        body: {
          data: [
            {
              id: 'page-1',
              name: 'My FB Page',
              access_token: 'page-at-1',
              picture: { data: { url: 'https://example.com/page.jpg' } },
              instagram_business_account: { id: 'ig-1', username: 'my_ig' },
            },
            {
              id: 'page-2',
              name: 'No IG Page',
              access_token: 'page-at-2',
            },
          ],
        },
      },
    ]);
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: f as unknown as typeof fetch });
    const pages = await c.listMyPages('long-at');
    expect(pages).toHaveLength(3);

    const fb = pages.find((p) => p.id === 'page-1')!;
    expect(fb.name).toBe('My FB Page');
    expect(fb.access_token).toBe('page-at-1');

    const ig = pages.find((p) => p.id === 'ig-1')!;
    expect(ig.name).toBe('@my_ig');
    expect(ig.access_token).toBe('page-at-1');
    expect(ig.instagram_username).toBe('my_ig');

    const standalone = pages.find((p) => p.id === 'page-2')!;
    expect(standalone.instagram_business_account_id).toBeUndefined();
  });

  it('returns an empty array when /me/accounts has no data', async () => {
    const f = mockFetch([{ body: { data: [] } }]);
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: f as unknown as typeof fetch });
    const pages = await c.listMyPages('long-at');
    expect(pages).toEqual([]);
  });
});

describe('createRealMetaClient.refreshLongLivedToken', () => {
  it('calls fb_exchange_token grant with the long-lived token', async () => {
    const f = mockFetch([
      { body: { access_token: 'long-at-fresh', expires_in: 5_184_000 } },
    ]);
    const c = createRealMetaClient({ ...DEFAULT_CONFIG, fetchImpl: f as unknown as typeof fetch });
    const tokens = await c.refreshLongLivedToken('long-at-old');
    expect(tokens.access_token).toBe('long-at-fresh');
    const call = f.calls()[0]!;
    expect(call.url).toContain('grant_type=fb_exchange_token');
    expect(call.url).toContain('fb_exchange_token=long-at-old');
  });
});
