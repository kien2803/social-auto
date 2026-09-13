import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestAppWithMock } from '../test-helpers.js';
import { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import type { FastifyInstance } from 'fastify';

describe('YouTube OAuth routes (T0.3)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildTestAppWithMock();
    app = built.app;
    await app.ready();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /auth/youtube/start redirects to local callback with state cookie and mock code', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/youtube/start' });
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'];
    expect(typeof location).toBe('string');
    // Mock-mode: bypass Google by redirecting straight to the local callback
    // with a synthetic code. Real mode (no mock client) goes to
    // accounts.google.com/o/oauth2/v2/auth — covered separately by
    // createRealGoogleClient.buildAuthUrl.
    expect(location).toContain('/auth/callback');
    expect(location).toContain('state=');
    expect(location).toContain('code=');
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toContain('oauth_state=');
  });

  it('Auth URL carries a code and state for the mock flow', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/youtube/start' });
    const location = String(res.headers['location']);
    // Scope is no longer embedded in the URL — the real Google path puts it
    // there, but the mock path skips Google entirely. What the OAuth
    // callback cares about is the code + state pair.
    expect(location).toContain('code=mock-code-');
    expect(location).toContain('state=');
  });

  it('GET /auth/callback with state mismatch returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=wrong',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'state mismatch' });
  });

  it('GET /auth/callback with matching state stores account and redirects', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/youtube/start' });
    const cookieHeader = start.headers['set-cookie'];
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    const stateMatch = /oauth_state=([^;]+)/.exec(String(cookieStr));
    expect(stateMatch).not.toBeNull();
    expect(stateMatch![1]).toBeTruthy();
  });

  it('GET /auth/callback clears oauth_state on state mismatch (no orphan cookie)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=wrong',
      headers: { cookie: 'oauth_state=corrrect' },
    });
    expect(res.statusCode).toBe(400);
    // The orphan-cookie hook should clear oauth_state even though the
    // callback bailed before its own explicit clearCookie.
    const clearHeaders = (res.headers['set-cookie'] ?? []) as string[];
    const oauthStateCleared = clearHeaders.some(
      (c) => c.startsWith('oauth_state=') && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    expect(oauthStateCleared).toBe(true);
  });

  it('GET /auth/youtube/start redirects to local callback with state cookie and mock code', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/youtube/start' });
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'];
    expect(typeof location).toBe('string');
    expect(location).toContain('/auth/callback');
    expect(location).toContain('state=');
    expect(location).toContain('code=');
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toContain('oauth_state=');
  });

  it('GET /auth/youtube/status with no account returns connected:false + empty accounts', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/youtube/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: false, accounts: [] });
  });
  it('GET /auth/callback twice with distinct mock channels inserts 2 account rows', async () => {
    // Build a fresh app that mounts BOTH auth + accounts routes so we can
    // assert the 2 rows landed. The default beforeEach() app only mounts
    // registerAuthRoutes; /accounts is part of registerAccountRoutes.
    const Fastify = (await import('fastify')).default;
    const cookie = (await import('@fastify/cookie')).default;
    const { openDB } = await import('../db.js');
    const { AccountsRepo } = await import('../repositories/accounts.js');
    const { registerAccountRoutes } = await import('../routes/accounts.js');
    const { createMockGoogleClient } = await import('../google/mockClient.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');

    const db = await openDB(':memory:');
    const repo = new AccountsRepo(db);
    const google = createMockGoogleClient();
    const app2 = Fastify({ logger: false });
    await app2.register(cookie);
    registerAuthRoutes(app2, {
      accounts: repo,
      google,
      webOrigin: 'http://localhost:5173',
      tokenEncryptionKey: 'a'.repeat(64),
    });
    registerAccountRoutes(app2, { accounts: repo, posts: new ScheduledPostsRepo(db) });

    // Walk both connect flows against the same in-memory DB.
    const start1 = await app2.inject({ method: 'GET', url: '/auth/youtube/start' });
    const cookie1 = String(Array.isArray(start1.headers['set-cookie']) ? start1.headers['set-cookie'][0] : start1.headers['set-cookie']);
    const state1 = /oauth_state=([^;]+)/.exec(cookie1)![1]!;
    const cb1 = await app2.inject({
      method: 'GET',
      url: `/auth/callback?code=mock-code-1&state=${state1}`,
      headers: { cookie: `oauth_state=${state1}` },
    });
    expect(cb1.statusCode).toBe(302);

    const start2 = await app2.inject({ method: 'GET', url: '/auth/youtube/start' });
    const cookie2 = String(Array.isArray(start2.headers['set-cookie']) ? start2.headers['set-cookie'][0] : start2.headers['set-cookie']);
    const state2 = /oauth_state=([^;]+)/.exec(cookie2)![1]!;
    const cb2 = await app2.inject({
      method: 'GET',
      url: `/auth/callback?code=mock-code-2&state=${state2}`,
      headers: { cookie: `oauth_state=${state2}` },
    });
    expect(cb2.statusCode).toBe(302);

    const list = await app2.inject({ method: 'GET', url: '/accounts' });
    const listBody = list.json() as { accounts: Array<{ platform: string; external_id: string; display_name: string }> };
    const yt = listBody.accounts.filter((a) => a.platform === 'youtube');
    expect(yt).toHaveLength(2);
    const ids = new Set(yt.map((a) => a.external_id));
    expect(ids.size).toBe(2);
    expect(yt.map((a) => a.display_name).sort()).toEqual(['Mock Channel 1', 'Mock Channel 2']);
    await app2.close();
  });

  it('GET /auth/youtube/status marks account expired when access token is rejected by Google', async () => {
    // Insert a bogus account row whose stored access token fails decryption
    // marks the account as 'expired' in its response rather than failing the
    // whole request — callers see per-account status and can prompt for
    // reconnect on the UI side.
    const { openDB } = await import('../db.js');
    const { AccountsRepo } = await import('../repositories/accounts.js');
    const Fastify = (await import('fastify')).default;
    const cookie = (await import('@fastify/cookie')).default;
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { createMockGoogleClient } = await import('../google/mockClient.js');

    const db = await openDB(':memory:');
    const repo = new AccountsRepo(db);
    repo.insert({
      platform: 'youtube',
      display_name: 'X',
      external_id: 'UC_bogus',
      // Stored ciphertext has the wrong shape — the decrypt() call inside the
      // status route throws, so the route falls through to the expired branch.
      oauth_refresh_token: 'bogus:tag:ct',
      oauth_access_token: 'invalid-token-no-prefix',
      status: 'active',
    });

    const app2 = Fastify({ logger: false });
    await app2.register(cookie);
    registerAuthRoutes(app2, {
      accounts: repo,
      google: createMockGoogleClient(),
      webOrigin: 'http://localhost:5173',
      tokenEncryptionKey: 'a'.repeat(64),
    });
    await app2.ready();
    const res = await app2.inject({ method: 'GET', url: '/auth/youtube/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { connected: boolean; accounts: Array<{ status: string }> };
    expect(body.connected).toBe(true);
    expect(body.accounts).toHaveLength(1);
    const firstAccount = body.accounts[0];
    expect(firstAccount?.status).toBe('expired');
  });

  it('Refresh token persists across app restart (same DB file)', async () => {
    // Use a temp file path, run the full flow, close, reopen.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = path.join(os.tmpdir(), `social-auto-test-${Date.now()}.db`);

    const Fastify = (await import('fastify')).default;
    const cookie = (await import('@fastify/cookie')).default;
    const { openDB } = await import('../db.js');
    const { AccountsRepo } = await import('../repositories/accounts.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { createMockGoogleClient } = await import('../google/mockClient.js');

    // First app instance
    const app1 = Fastify({ logger: false });
    await app1.register(cookie);
    const db1 = await openDB(tmp);
    const accounts1 = new AccountsRepo(db1);
    registerAuthRoutes(app1, {
      accounts: accounts1,
      google: createMockGoogleClient(),
      webOrigin: 'http://localhost:5173',
      tokenEncryptionKey: 'a'.repeat(64),
    });
    await app1.ready();
    const start = await app1.inject({ method: 'GET', url: '/auth/youtube/start' });
    const cookieHeader = start.headers['set-cookie'];
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    const stateMatch = /oauth_state=([^;]+)/.exec(String(cookieStr));
    const state = stateMatch![1];
    await app1.inject({
      method: 'GET',
      url: `/auth/callback?code=c1&state=${state}`,
      headers: { cookie: `oauth_state=${state}` },
    });
    await app1.close();

    // Verify file on disk
    expect(fs.existsSync(tmp)).toBe(true);

    // Second app instance reading same file
    const app2 = Fastify({ logger: false });
    await app2.register(cookie);
    const db2 = await openDB(tmp);
    const accounts2 = new AccountsRepo(db2);
    registerAuthRoutes(app2, {
      accounts: accounts2,
      google: createMockGoogleClient(),
      webOrigin: 'http://localhost:5173',
      tokenEncryptionKey: 'a'.repeat(64),
    });
    await app2.ready();
    const status = await app2.inject({ method: 'GET', url: '/auth/youtube/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().connected).toBe(true);
    await app2.close();

    fs.unlinkSync(tmp);
  });

  it('GET /auth/youtube/start?popup=1 sets the oauth_popup cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/youtube/start?popup=1' });
    expect(res.statusCode).toBe(302);
    const cookies = res.headers['set-cookie'];
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toContain('oauth_popup=1');
  });

  it('GET /auth/callback redirects to /auth/popup-close when popup cookie is set', async () => {
    // Drive the mock OAuth chain: start -> capture state -> callback.
    const start = await app.inject({ method: 'GET', url: '/auth/youtube/start?popup=1' });
    const cookies = (start.headers['set-cookie'] ?? []) as string[];
    const stateCookie = cookies.find((c) => c.startsWith('oauth_state='));
    expect(stateCookie).toBeDefined();
    const state = new RegExp(/oauth_state=([^;]+)/).exec(stateCookie as string)?.[1];
    expect(state).toBeTruthy();
    const cb = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${state}`,
      headers: { cookie: `oauth_state=${state}; oauth_popup=1` },
    });
    expect(cb.statusCode).toBe(302);
    const location = String(cb.headers['location']);
    expect(location).toContain('/auth/popup-close');
    expect(location).toContain('result=');
  });

  it('GET /auth/callback clears the popup cookie so the next flow starts fresh', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/youtube/start?popup=1' });
    const cookies = (start.headers['set-cookie'] ?? []) as string[];
    const stateCookie = cookies.find((c) => c.startsWith('oauth_state='));
    const state = new RegExp(/oauth_state=([^;]+)/).exec(stateCookie as string)?.[1];
    const cb = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${state}`,
      headers: { cookie: `oauth_state=${state}; oauth_popup=1` },
    });
    const cbCookies = (cb.headers['set-cookie'] ?? []) as string[];
    const popupClear = cbCookies.find(
      (c) => c.startsWith('oauth_popup=') && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    expect(popupClear).toBeDefined();
  });
 });

describe('Mock multi-platform auth (T2.2/T2.3)', () => {
  async function buildMockAuthApp() {
    const Fastify = (await import('fastify')).default;
    const cookie = (await import('@fastify/cookie')).default;
    const { openDB } = await import('../db.js');
    const { AccountsRepo } = await import('../repositories/accounts.js');
    const { registerAccountRoutes } = await import('../routes/accounts.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { createMockGoogleClient } = await import('../google/mockClient.js');
    const { createMockTiktokClient } = await import('../tiktok/mockClient.js');
    const { registerTiktokAuthRoutes } = await import('../tiktok/authRoutes.js');
    const { ScheduledPostsRepo } = await import('../repositories/scheduledPosts.js');

    process.env['USE_MOCK_GOOGLE'] = 'true';
    process.env['TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(64);
    process.env['WEB_ORIGIN'] = 'http://localhost:5173';

    const app = Fastify({ logger: false });
    await app.register(cookie);
    const db = await openDB(':memory:');
    const accounts = new AccountsRepo(db);
    const google = createMockGoogleClient();
    const tiktok = createMockTiktokClient();
    registerAuthRoutes(app, {
      accounts,
      google,
      webOrigin: 'http://localhost:5173',
      tokenEncryptionKey: 'a'.repeat(64),
    useMockPublishers: true,
    });
    registerTiktokAuthRoutes(app, {
      accounts,
      tiktok,
      webOrigin: 'http://localhost:5173',
      tokenEncryptionKey: 'a'.repeat(64),
    });
    registerAccountRoutes(app, { accounts, posts: new ScheduledPostsRepo(db) });
    app.addHook('onClose', async () => db.close());
    await app.ready();
    return app;
  }

  // TikTok uses the real OAuth + PKCE flow (tiktok/authRoutes.ts); the
  // browser-supplied cookies are required to validate the state + verifier.
  describe('tiktok (PKCE flow)', () => {
    it('/auth/tiktok/start redirects to local callback with code+state+challenge', async () => {
      const app = await buildMockAuthApp();
      const res = await app.inject({ method: 'GET', url: '/auth/tiktok/start' });
      expect(res.statusCode).toBe(302);
      const loc = res.headers['location'];
      expect(typeof loc).toBe('string');
      expect(loc).toContain('/auth/tiktok/callback');
      expect(loc).toContain('state=');
      expect(loc).toContain('code=');
      expect(loc).toContain('code_challenge=');
      await app.close();
    });

    it('/auth/tiktok/callback with matching state inserts a tiktok account', async () => {
      const app = await buildMockAuthApp();
      // Step 1: /start → set state + PKCE cookies.
      const start = await app.inject({ method: 'GET', url: '/auth/tiktok/start' });
      const setCookie = start.headers['set-cookie'];
      const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
        .filter(Boolean)
        .map((c) => c.split(';')[0]!)
        .join('; ');
      const loc = String(start.headers['location']);
      const u = new URL(loc, 'http://localhost:3000');
      const code = u.searchParams.get('code')!;
      const state = u.searchParams.get('state')!;

      // Step 2: hit /callback with the cookies + matching state + code.
      const cb = await app.inject({
        method: 'GET',
        url: `/auth/tiktok/callback?code=${code}&state=${state}`,
        headers: { cookie: cookies },
      });
      expect(cb.statusCode).toBe(302);

      const list = await app.inject({ method: 'GET', url: '/accounts' });
      const body = list.json() as {
        accounts: Array<{ platform: string; status: string; display_name: string }>;
      };
      const tt = body.accounts.filter((a) => a.platform === 'tiktok');
      expect(tt).toHaveLength(1);
      expect(tt[0]?.status).toBe('active');
      expect(tt[0]?.display_name.toLowerCase()).toContain('tiktok');
      await app.close();
    });

    it('/auth/tiktok/callback with state mismatch returns 400', async () => {
      const app = await buildMockAuthApp();
      const cb = await app.inject({
        method: 'GET',
        url: '/auth/tiktok/callback?code=abc&state=wrong',
      });
      expect(cb.statusCode).toBe(400);
      await app.close();
    });
  });

  // Instagram + Facebook keep the legacy mock block (no PKCE, no state).
  for (const platform of ['instagram', 'facebook'] as const) {
    it(`/auth/${platform}/start redirects through /callback (inserts account)`, async () => {
      // BUG-NEW-004: the previous behavior redirected to webOrigin with
      // ?connected=<platform>&code=<code> and the account was never
      // inserted. The fix routes /start -> /auth/<platform>/callback so
      // the account row is actually persisted before the browser returns
      // to the web shell. See plans/core/phase-3-polish/fix-bugs.md.
      const app = await buildMockAuthApp();
      const res = await app.inject({ method: 'GET', url: `/auth/${platform}/start` });
      expect(res.statusCode).toBe(302);
      const loc = String(res.headers['location']);
      expect(typeof loc).toBe('string');
      // Regression guard: /start must NOT skip straight to the web
      // without first going through /callback.
      expect(loc).not.toContain('/accounts?connected=');
      expect(loc).toMatch(new RegExp(`^/auth/${platform}/callback\\?code=${platform}-[a-f0-9]+$`));

      // inject() does not auto-follow redirects — drive the chain manually
      // so the account row lands before we assert.
      const chainCode = new URL(loc, 'http://localhost:3000').searchParams.get('code')!;
      const cb = await app.inject({
        method: 'GET',
        url: `/auth/${platform}/callback?code=${chainCode}`,
      });
      expect(cb.statusCode).toBe(302);
      const webLoc = cb.headers['location'] as string;
      expect(webLoc).toContain(`/accounts?connected=${platform}`);
      expect(webLoc).toContain('account=');

      const list = await app.inject({ method: 'GET', url: '/accounts' });
      const body = list.json() as { accounts: Array<{ platform: string }> };
      const filtered = body.accounts.filter((a) => a.platform === platform);
      expect(filtered).toHaveLength(1);
      await app.close();
    });


    it(`/auth/${platform}/callback inserts a new ${platform} account`, async () => {
      const app = await buildMockAuthApp();
      const code = `${platform}-test-1`;
      const cb = await app.inject({
        method: 'GET',
        url: `/auth/${platform}/callback?code=${code}`,
      });
      expect(cb.statusCode).toBe(302);
      const loc = cb.headers['location'] as string;
      expect(loc).toContain(`account=`);

      const list = await app.inject({ method: 'GET', url: '/accounts' });
      const body = list.json() as { accounts: Array<{ platform: string; status: string; display_name: string }> };
      const filtered = body.accounts.filter((a) => a.platform === platform);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.status).toBe('active');
      expect(filtered[0]?.display_name.toLowerCase()).toContain(platform);
      await app.close();
    });

    it(`/auth/${platform}/callback twice with same code reconnects (1 row)`, async () => {
      const app = await buildMockAuthApp();
      const code = `${platform}-test-reconnect`;
      await app.inject({ method: 'GET', url: `/auth/${platform}/callback?code=${code}` });
      await app.inject({ method: 'GET', url: `/auth/${platform}/callback?code=${code}` });
      const list = await app.inject({ method: 'GET', url: '/accounts' });
      const body = list.json() as { accounts: Array<{ platform: string }> };
      const filtered = body.accounts.filter((a) => a.platform === platform);
      expect(filtered).toHaveLength(1);
      await app.close();
    });
  }

  it('All 2 non-YouTube+non-TikTok mock platforms connect in sequence → 2 distinct rows', async () => {
    const app = await buildMockAuthApp();
    for (const platform of ['instagram', 'facebook'] as const) {
      const code = `${platform}-seq-${Date.now()}`;
      const res = await app.inject({
        method: 'GET',
        url: `/auth/${platform}/callback?code=${code}`,
      });
      expect(res.statusCode).toBe(302);
    }
    const list = await app.inject({ method: 'GET', url: '/accounts' });
    const body = list.json() as { accounts: Array<{ platform: string }> };
    const nonYt = body.accounts.filter((a) => a.platform !== 'youtube');
    expect(nonYt).toHaveLength(2);
    const seen = new Set(nonYt.map((a) => a.platform));
    expect(seen).toEqual(new Set(['instagram', 'facebook']));
    await app.close();
  });
  it('TikTok mock + Instagram/Facebook mock all reach /accounts', async () => {
    const app = await buildMockAuthApp();
    // Connect IG + FB via the legacy mock block.
    for (const platform of ['instagram', 'facebook'] as const) {
      const code = `${platform}-seq-${Date.now()}`;
      const res = await app.inject({
        method: 'GET',
        url: `/auth/${platform}/callback?code=${code}`,
      });
      expect(res.statusCode).toBe(302);
    }
    // Connect TikTok via the PKCE flow.
    const start = await app.inject({ method: 'GET', url: '/auth/tiktok/start' });
    const setCookie = start.headers['set-cookie'];
    const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
      .filter(Boolean)
      .map((c) => c.split(';')[0]!)
      .join('; ');
    const loc = String(start.headers['location']);
    const u = new URL(loc, 'http://localhost:3000');
    const code = u.searchParams.get('code')!;
    const state = u.searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET',
      url: `/auth/tiktok/callback?code=${code}&state=${state}`,
      headers: { cookie: cookies },
    });
    expect(cb.statusCode).toBe(302);

    const list = await app.inject({ method: 'GET', url: '/accounts' });
    const body = list.json() as { accounts: Array<{ platform: string }> };
    const nonYt = body.accounts.filter((a) => a.platform !== 'youtube');
    expect(nonYt).toHaveLength(3);
    const seen = new Set(nonYt.map((a) => a.platform));
    expect(seen).toEqual(new Set(['tiktok', 'instagram', 'facebook']));
    await app.close();
  });
});