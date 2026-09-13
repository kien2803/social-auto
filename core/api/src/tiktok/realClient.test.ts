import { describe, it, expect } from 'vitest';
import { createRealTiktokClient } from './realClient.js';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface MockFetch extends Pick<typeof globalThis, 'fetch'> {
  calls(): FetchCall[];
}

/**
 * Build a fetch stub that returns the queued responses in order. Extra
 * calls past the queue length reuse the last response. A `calls()`
 * accessor exposes the captured (url, init) for assertions without
 * inline `as` casts.
 */
function mockFetch(responses: Array<{ status?: number; body: unknown }>): MockFetch {
  const calls: FetchCall[] = [];
  let i = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const next = responses[i] ?? responses[responses.length - 1];
    if (!next) {
      throw new Error(`mockFetch: no response queued for call #${i + 1} ${url}`);
    }
    i += 1;
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(body, {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Object.assign(impl, {
    calls: () => calls,
  }) as unknown as MockFetch;
}

describe('createRealTiktokClient.buildAuthUrl', () => {
  it('includes client_key, PKCE challenge, state, scopes, and S256 method', () => {
    const f = mockFetch([]);
    const c = createRealTiktokClient({
      clientKey: 'ck_abc',
      clientSecret: 'cs_xyz',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    const url = new URL(c.buildAuthUrl('state-1', 'challenge-1'));
    expect(url.host).toBe('www.tiktok.com');
    expect(url.pathname).toBe('/v2/auth/authorize/');
    expect(url.searchParams.get('client_key')).toBe('ck_abc');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('video.upload');
    expect(url.searchParams.get('scope')).toContain('video.publish');
  });
});

describe('createRealTiktokClient.exchangeCode', () => {
  it('POSTs form-encoded body and parses expires_in to ms epoch', async () => {
    const f = mockFetch([
      {
        body: {
          access_token: 'at-1',
          refresh_token: 'rt-1',
          open_id: 'open-1',
          expires_in: 86400,
          token_type: 'Bearer',
          scope: 'user.info.basic,video.upload,video.publish',
        },
      },
    ]);
    const c = createRealTiktokClient({
      clientKey: 'ck',
      clientSecret: 'cs',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    const before = Date.now();
    const tokens = await c.exchangeCode('code-1', 'verifier-1');
    const after = Date.now();

    expect(tokens.access_token).toBe('at-1');
    expect(tokens.refresh_token).toBe('rt-1');
    expect(tokens.open_id).toBe('open-1');
    const expected = before + 86_400_000;
    expect(tokens.expires_at).toBeGreaterThanOrEqual(expected - 1000);
    expect(tokens.expires_at).toBeLessThanOrEqual(after + 86_400_000 + 1000);

    const calls = f.calls();
    expect(calls[0]?.url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = String(calls[0]?.init?.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=code-1');
    expect(body).toContain('code_verifier=verifier-1');
    expect(body).toContain('client_key=ck');
    expect(body).toContain('client_secret=cs');
  });

  it('requires a non-empty codeVerifier (PKCE)', async () => {
    const f = mockFetch([]);
    const c = createRealTiktokClient({
      clientKey: 'ck',
      clientSecret: 'cs',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    await expect(c.exchangeCode('code-1', '')).rejects.toThrow(/PKCE/);
  });

  it('throws when access_token is missing from the response', async () => {
    const f = mockFetch([{ body: { refresh_token: 'rt', open_id: 'o', expires_in: 1 } }]);
    const c = createRealTiktokClient({
      clientKey: 'ck',
      clientSecret: 'cs',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    await expect(c.exchangeCode('c', 'v')).rejects.toThrow(/access_token/);
  });
});

describe('createRealTiktokClient.refresh', () => {
  it('POSTs grant_type=refresh_token and returns fresh tokens', async () => {
    const f = mockFetch([
      {
        body: {
          access_token: 'at-r',
          refresh_token: 'rt-r',
          open_id: 'open-1',
          expires_in: 86400,
          token_type: 'Bearer',
        },
      },
    ]);
    const c = createRealTiktokClient({
      clientKey: 'ck',
      clientSecret: 'cs',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    const tokens = await c.refresh('rt-1');
    expect(tokens.access_token).toBe('at-r');
    const calls = f.calls();
    expect(String(calls[0]?.init?.body)).toContain('grant_type=refresh_token');
    expect(String(calls[0]?.init?.body)).toContain('refresh_token=rt-1');
  });
});

describe('createRealTiktokClient.getMyUser', () => {
  it('calls /v2/user/info/ with Bearer token and parses data.user', async () => {
    const f = mockFetch([
      {
        body: {
          data: {
            user: {
              open_id: 'o1',
              display_name: 'TikTok Creator',
              avatar_url: 'https://example.com/avatar.jpg',
            },
          },
        },
      },
    ]);
    const c = createRealTiktokClient({
      clientKey: 'ck',
      clientSecret: 'cs',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    const user = await c.getMyUser('at');
    expect(user.open_id).toBe('o1');
    expect(user.display_name).toBe('TikTok Creator');
    expect(user.avatar_url).toBe('https://example.com/avatar.jpg');
    const calls = f.calls();
    expect(calls[0]?.url).toContain('https://open.tiktokapis.com/v2/user/info/');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer at');
  });

  it('throws when error is in the response body', async () => {
    const f = mockFetch([{ body: { error: { code: 'invalid_token', message: 'no' } } }]);
    const c = createRealTiktokClient({
      clientKey: 'ck',
      clientSecret: 'cs',
      redirectUri: 'http://localhost:3000/auth/tiktok/callback',
      fetchImpl: f as unknown as typeof fetch,
    });
    await expect(c.getMyUser('at')).rejects.toThrow(/invalid_token/);
  });
});
