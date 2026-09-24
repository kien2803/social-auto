/**
 * Worker integration tests against an in-memory SQLite. Run pollOnce directly
 * so we don't need a 30-second poll loop.
 *
 * Exercises the post-OAuth-fix token lifecycle:
 *   - cached token still valid → publish OK
 *   - cached token near expiry (60s skew window) → worker refreshes → publish OK
 *   - cached token already expired → worker refreshes → publish OK
 *   - refresh() throws invalid_grant → account marked 'expired', post 'failed'
 *   - account already in 'expired' state → worker skips, post 'failed' with
 *     a clear message so the UI can prompt for reconnect
 *   - poll loop only picks posts whose scheduled_at is in the past
 *
 * Test environment is set up in vitest.config.ts (env block) so that env.ts
 * sees deterministic values BEFORE its module-load evaluation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openDB, type DB } from './db.js';
import { AccountsRepo } from './repositories/accounts.js';
import { ScheduledPostsRepo } from './repositories/scheduledPosts.js';
import { VideosRepo } from './repositories/videos.js';
import { QuotasRepo } from './repositories/quotas.js';
import { pollOnce } from './index.js';
import { encrypt } from '@social-auto/shared/utils/crypto.js';
import type { GoogleOAuthClient } from './publishers/googleClientTypes.js';
import { QuotaManager } from './services/quotaManager.js';

const TOKEN_KEY = 'a'.repeat(64);

function makeStubGoogle(mode: 'ok' | 'invalid_grant'): GoogleOAuthClient {
  return {
    buildAuthUrl: () => 'http://stub/auth',
    exchangeCode: async () => ({
      access_token: 'mock-access-1',
      expires_at: Date.now() + 3600_000,
      refresh_token: 'mock-refresh-1',
      scope: 'youtube.upload',
      token_type: 'Bearer',
    }),
    refresh:
      mode === 'ok'
        ? async (rt: string) => ({
            access_token: `mock-access-refreshed-${rt}`,
            expires_at: Date.now() + 3600_000,
            refresh_token: rt,
            scope: 'youtube.upload',
            token_type: 'Bearer',
          })
        : async () => {
            throw new Error('invalid_grant: Token has been expired or revoked');
          },
    getMyChannel: async () => ({ id: 'UC_mock', title: 'Mock Channel' }),
  };
}

interface Deps {
  db: DB;
  accounts: AccountsRepo;
  posts: ScheduledPostsRepo;
  videos: VideosRepo;
  quotas: QuotasRepo;
  google: GoogleOAuthClient;
  quotaManager: QuotaManager;
}

let deps: Deps;

beforeEach(async () => {
  const db = await openDB(':memory:');
  const accounts = new AccountsRepo(db);
  const posts = new ScheduledPostsRepo(db);
  const videos = new VideosRepo(db);
  const quotas = new QuotasRepo(db);
  const quotaManager = new QuotaManager(quotas);
  deps = { db, accounts, posts, videos, quotas, google: makeStubGoogle('ok'), quotaManager };
});

function makeActiveAccount(opts?: {
  expiresAt?: number | null;
  status?: 'active' | 'expired';
}): string {
  const expiresAt = opts?.expiresAt === undefined ? Date.now() + 3600_000 : opts.expiresAt;
  const status = opts?.status ?? 'active';
  return deps.accounts
    .insert({
      platform: 'youtube',
      display_name: 'Mock Channel',
      oauth_refresh_token: encrypt('mock-refresh-1', TOKEN_KEY),
      oauth_access_token: encrypt('mock-access-cached', TOKEN_KEY),
      token_expires_at: expiresAt,
      status,
    })
    .id;
}

function makeVideo(): string {
  return deps.videos
    .insert({
      file_path: '/tmp/worker-test.mp4',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
      duration_sec: 30,
    })
    .id;
}

function makeDuePost(videoId: string, accountId: string): string {
  return deps.posts
    .insert({
      video_id: videoId,
      account_id: accountId,
      scheduled_at: Date.now() - 1000,
      caption: 'Title\nDescription body\n#tag1 #tag2',
      visibility: 'unlisted',
    })
    .id;
}

describe('worker pollOnce — token lifecycle', () => {
  it('publishes successfully when cached token is still valid', async () => {
    const accountId = makeActiveAccount({ expiresAt: Date.now() + 60 * 60_000 });
    const videoId = makeVideo();
    const postId = makeDuePost(videoId, accountId);

    await pollOnce(deps);

    const post = deps.posts.findById(postId);
    expect(post?.status).toBe('published');
    expect(post?.external_post_id).toMatch(/^mock-yt-/);
  });

  it('refreshes token when expiry is inside the 60s skew window', async () => {
    const accountId = makeActiveAccount({ expiresAt: Date.now() + 10_000 });
    const videoId = makeVideo();
    const postId = makeDuePost(videoId, accountId);

    await pollOnce(deps);

    const post = deps.posts.findById(postId);
    expect(post?.status).toBe('published');
    const acc = deps.accounts.findById(accountId);
    expect(acc?.token_expires_at).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it('refreshes token when it has already expired', async () => {
    const accountId = makeActiveAccount({ expiresAt: Date.now() - 60_000 });
    const videoId = makeVideo();
    const postId = makeDuePost(videoId, accountId);

    await pollOnce(deps);

    const post = deps.posts.findById(postId);
    expect(post?.status).toBe('published');
  });

  it('marks account expired and post failed when refresh returns invalid_grant', async () => {
    deps.google = makeStubGoogle('invalid_grant');
    const accountId = makeActiveAccount({ expiresAt: Date.now() - 1000 });
    const videoId = makeVideo();
    const postId = makeDuePost(videoId, accountId);

    await pollOnce(deps);

    const acc = deps.accounts.findById(accountId);
    expect(acc?.status).toBe('expired');
    const post = deps.posts.findById(postId);
    expect(post?.status).toBe('failed');
    expect(post?.last_error).toMatch(/account_expired/);
  });

  it('does not publish for accounts already marked expired', async () => {
    const accountId = makeActiveAccount({
      expiresAt: Date.now() + 60_000,
      status: 'expired',
    });
    const videoId = makeVideo();
    const postId = makeDuePost(videoId, accountId);

    await pollOnce(deps);

    const post = deps.posts.findById(postId);
    expect(post?.status).toBe('failed');
    expect(post?.last_error).toMatch(/account_expired_reconnect_required/);
  });

  it('claims only posts whose scheduled_at is in the past', async () => {
    const accountId = makeActiveAccount();
    const videoId = makeVideo();

    const pastId = makeDuePost(videoId, accountId);
    deps.posts.insert({
      video_id: videoId,
      account_id: accountId,
      scheduled_at: Date.now() + 60_000,
      caption: 'future',
    });

    await pollOnce(deps);

    expect(deps.posts.findById(pastId)?.status).toBe('published');
    const future = deps.posts.list({ status: 'pending' });
    expect(future).toHaveLength(1);
  });
});
