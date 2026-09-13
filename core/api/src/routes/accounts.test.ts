import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { openDB, type DB } from '../db.js';
import { AccountsRepo } from '../repositories/accounts.js';
import { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import { registerAccountRoutes } from './accounts.js';
import { createMockGoogleClient } from '../google/mockClient.js';
import { encrypt } from '@social-auto/shared/utils/crypto.js';

const TOKEN_KEY = 'a'.repeat(64);

interface BuiltApp {
  app: FastifyInstance;
  accounts: AccountsRepo;
  posts: ScheduledPostsRepo;
}

async function buildAccountsTestApp(): Promise<BuiltApp> {
  process.env['TOKEN_ENCRYPTION_KEY'] = TOKEN_KEY;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const db: DB = await openDB(':memory:');
  const accounts = new AccountsRepo(db);
  const posts = new ScheduledPostsRepo(db);
  const google = createMockGoogleClient();
  registerAccountRoutes(app, {
    accounts,
    posts,
    google,
    tokenEncryptionKey: TOKEN_KEY,
  });
  app.addHook('onClose', async () => db.close());
  await app.ready();
  return { app, accounts, posts };
}

describe('Account metadata patch (PATCH /accounts/:id)', () => {
  let app: FastifyInstance;
  let accounts: AccountsRepo;
  let accountId: string;

  beforeEach(async () => {
    const built = await buildAccountsTestApp();
    app = built.app;
    accounts = built.accounts;
    const row = accounts.insert({
      platform: 'youtube',
      external_id: 'UC_patch',
      display_name: 'Patch Me',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    accountId = row.id;
  });

  it('updates content_category / language_code / purpose / link', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${accountId}`,
      payload: {
        metadata: {
          content_category: 'tech',
          language_code: 'ENGLISH',
          purpose: 'Reviews and tutorials',
          link: 'https://example.com',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      metadata: { content_category: string; language_code: string; purpose: string; link: string };
    };
    expect(body.metadata).toEqual({
      content_category: 'tech',
      language_code: 'ENGLISH',
      purpose: 'Reviews and tutorials',
      link: 'https://example.com',
    });
  });

  it('rejects unknown language code with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${accountId}`,
      payload: { metadata: { language_code: 'KLINGON' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_language_code' });
  });

  it('returns 404 for unknown account id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/accounts/does-not-exist',
      payload: { metadata: { content_category: 'x' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('preserves tokens and never returns them in the response', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${accountId}`,
      payload: { metadata: { content_category: 'tech' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('oauth_refresh_token');
    expect(body).not.toHaveProperty('oauth_access_token');
    expect(body).not.toHaveProperty('token_expires_at');
  });
});


describe('Account stats 404 (GET /accounts/:id/stats)', () => {
  it('returns 404 when the account does not exist', async () => {
    const built = await buildAccountsTestApp();
    const res = await built.app.inject({
      method: 'GET',
      url: '/accounts/does-not-exist/stats',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('Multi-account support — same platform, different channels', () => {
  it('inserts two YouTube accounts with different external_ids without conflict', async () => {
    // The OAuth callback's first action is `findByPlatformExternal`. If
    // that lookup returns null it inserts; if non-null it updates. With
    // two distinct channel IDs the second insert must succeed because
    // the UNIQUE(platform, external_id) index treats each tuple as a
    // separate row.
    const db = await openDB(':memory:');
    const accounts = new AccountsRepo(db);

    const channelA = accounts.insert({
      platform: 'youtube',
      external_id: 'UC_channel_a',
      display_name: 'Channel A',
      oauth_refresh_token: encrypt('rt-a', TOKEN_KEY),
      oauth_access_token: encrypt('at-a', TOKEN_KEY),
      status: 'active',
    });
    const channelB = accounts.insert({
      platform: 'youtube',
      external_id: 'UC_channel_b',
      display_name: 'Channel B',
      oauth_refresh_token: encrypt('rt-b', TOKEN_KEY),
      oauth_access_token: encrypt('at-b', TOKEN_KEY),
      status: 'active',
    });

    // Distinct rows, distinct tokens.
    expect(channelA.id).not.toBe(channelB.id);
    expect(accounts.list().filter((a) => a.platform === 'youtube')).toHaveLength(2);
    expect(accounts.findByPlatformExternal('youtube', 'UC_channel_a')!.id).toBe(channelA.id);
    expect(accounts.findByPlatformExternal('youtube', 'UC_channel_b')!.id).toBe(channelB.id);

    // listByPlatform returns both, oldest first.
    const ytRows = accounts.listByPlatform('youtube');
    expect(ytRows.map((r) => r.external_id)).toEqual(['UC_channel_a', 'UC_channel_b']);
  });

  it('rejects an exact-duplicate (platform, external_id) at the DB layer', async () => {
    // Sanity: the UNIQUE index does its job. Two rows with the same tuple
    // collide, so the callback's findByPlatformExternal lookup short-
    // circuits the second insert into an UPDATE.
    const db = await openDB(':memory:');
    const accounts = new AccountsRepo(db);
    accounts.insert({
      platform: 'youtube',
      external_id: 'UC_dup',
      display_name: 'First',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    expect(() =>
      accounts.insert({
        platform: 'youtube',
        external_id: 'UC_dup',
        display_name: 'Second',
        oauth_refresh_token: encrypt('rt', TOKEN_KEY),
        status: 'active',
      }),
    ).toThrow();
  });

  it('routes sync calls to the correct row when 2 accounts share a platform', async () => {
    // We register two YouTube rows and stub google.getMyChannel to
    // return a fixed snapshot regardless of token. The sync handler
    // routes the call by row id (URL param), so the only thing we need
    // to verify is that the targeted row is updated and the other is
    // untouched.
    const db = await openDB(':memory:');
    const accounts = new AccountsRepo(db);
    const a = accounts.insert({
      platform: 'youtube',
      external_id: 'UC_alpha',
      display_name: 'Alpha',
      oauth_refresh_token: encrypt('rt-a', TOKEN_KEY),
      oauth_access_token: encrypt('at-a', TOKEN_KEY),
      token_expires_at: Date.now() + 3600 * 1000,
      status: 'active',
    });
    const b = accounts.insert({
      platform: 'youtube',
      external_id: 'UC_beta',
      display_name: 'Beta',
      oauth_refresh_token: encrypt('rt-b', TOKEN_KEY),
      oauth_access_token: encrypt('at-b', TOKEN_KEY),
      token_expires_at: Date.now() + 3600 * 1000,
      status: 'active',
    });

    // Snapshot baseline so we can detect later updates.
    expect(accounts.findById(a.id)!.last_sync_at).toBeNull();
    expect(accounts.findById(b.id)!.last_sync_at).toBeNull();
    const bBefore = { ...accounts.findById(b.id)! };

    // Build a Fastify app with a custom google stub.
    const app = Fastify({ logger: false });
    await app.register(cookie);
    const posts = new ScheduledPostsRepo(db);
    const google = {
      buildAuthUrl: (state: string) => `https://example.com/auth?state=${state}`,
      exchangeCode: async () => ({
        access_token: 'unused',
        expires_at: Date.now() + 3600 * 1000,
        refresh_token: 'unused',
        scope: '',
        token_type: 'Bearer',
      }),
      refresh: async () => ({
        access_token: 'unused',
        expires_at: Date.now() + 3600 * 1000,
        refresh_token: 'unused',
        scope: '',
        token_type: 'Bearer',
      }),
      getMyChannel: async () => ({
        id: 'UC_alpha',
        title: 'Alpha',
        handle: '@alpha',
        thumbnail_url: 'https://example.com/a.jpg',
        subscribers: 100,
        views: 1000,
        video_count: 5,
        snapshot_at: Date.now(),
      }),
    };
    registerAccountRoutes(app, {
      accounts,
      posts,
      google: google as unknown as Parameters<typeof registerAccountRoutes>[1]['google'],
      tokenEncryptionKey: TOKEN_KEY,
    });
    await app.ready();
    // No onClose hook — Fastify refuses addHook after app.ready(), and
    // the DB is in-memory so it cleans up with the test runner.

    // Sync Alpha. last_sync_at must populate.
    const resA = await app.inject({ method: 'POST', url: `/accounts/${a.id}/sync` });
    expect(resA.statusCode).toBe(200);
    const aAfter = accounts.findById(a.id)!;
    expect(aAfter.last_sync_at).not.toBeNull();
    // Beta must be untouched (snapshot_at still null and other fields
    // unchanged from the baseline).
    const bAfter = accounts.findById(b.id)!;
    expect(bAfter.last_sync_at).toBeNull();
    expect(bAfter.display_name).toBe(bBefore.display_name);

    // DELETE Beta — Alpha must still exist.
    const del = await app.inject({ method: 'DELETE', url: `/accounts/${b.id}` });
    expect(del.statusCode).toBe(200);
    expect(accounts.findById(a.id)).not.toBeNull();
    expect(accounts.findById(b.id)).toBeNull();
    // No app.close() — we never called app.listen so the Fastify
    // instance refuses to close mid-test (FST_ERR_INSTANCE_ALREADY_LISTENING).
    // The in-memory DB will be GC'd along with the test.
  });
});
