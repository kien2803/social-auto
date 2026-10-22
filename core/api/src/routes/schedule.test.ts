import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDB } from '../db.js';
import { AccountsRepo } from '../repositories/accounts.js';
import { VideosRepo } from '../repositories/videos.js';
import { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import { UsersRepo } from '../repositories/users.js';
import { registerScheduleRoutes } from './schedule.js';
import { encrypt } from '@social-auto/shared/utils/crypto.js';

const TOKEN_KEY = 'a'.repeat(64);

async function buildTestApp(): Promise<{ app: FastifyInstance; accounts: AccountsRepo; videos: VideosRepo; posts: ScheduledPostsRepo; users: UsersRepo }> {
  const app = Fastify({ logger: false });
  const db = await openDB(':memory:');
  const users = new UsersRepo(db);
  const accounts = new AccountsRepo(db);
  const videos = new VideosRepo(db);
  const posts = new ScheduledPostsRepo(db);
  const mockAuthMiddleware = async (req: any, _reply: any) => {
    req.userId = 'test-user-id';
  };
  registerScheduleRoutes(app, { posts, videos, accounts, authMiddleware: mockAuthMiddleware });
  app.addHook('onClose', async () => db.close());
  await app.ready();
  return { app, accounts, videos, posts, users };
}

describe('Schedule routes (T1.3)', () => {
  let app: FastifyInstance;
  let accounts: AccountsRepo;
  let videos: VideosRepo;
  let posts: ScheduledPostsRepo;
  let users: UsersRepo;

  beforeEach(async () => {
    const built = await buildTestApp();
    app = built.app;
    accounts = built.accounts;
    videos = built.videos;
    posts = built.posts;
    users = built.users;
    // Create test user
    users.insert({
      id: 'test-user-id',
      email: 'test@example.com',
      password_hash: 'hash',
      name: 'Test User',
    });
  });

  it('POST /schedule creates a pending post', async () => {
    const video = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const acc = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 'test',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/schedule',
      payload: {
        video_id: video.id,
        account_ids: [acc.id],
        caption: 'My title\nDescription here',
        scheduled_at: Date.now() + 5 * 60 * 1000,
        visibility: 'private',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].status).toBe('pending');
    expect(body.posts[0].video_id).toBe(video.id);
  });

  it('POST /schedule rejects too-soon timestamp', async () => {
    const video = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'b'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const acc = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 't',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/schedule',
      payload: {
        video_id: video.id,
        account_ids: [acc.id],
        caption: 'x',
        scheduled_at: Date.now() + 1000, // <60s
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /schedule creates one row per selected account (Phase 2 multi-platform)', async () => {
    const video = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'c'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const yt = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 'yt',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    const tt = accounts.insert({
      user_id: 'test-user-id',
      platform: 'tiktok',
      display_name: 'tt',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/schedule',
      payload: {
        video_id: video.id,
        account_ids: [yt.id, tt.id],
        caption: 'shared caption',
        per_platform_caption: { [tt.id]: 'short tiktok caption' },
        scheduled_at: Date.now() + 5 * 60 * 1000,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.posts).toHaveLength(2);
    const ttPost = body.posts.find((p: { account_id: string }) => p.account_id === tt.id);
    expect(ttPost.caption).toBe('short tiktok caption');
  });

  it('PATCH /schedule/:id updates pending post', async () => {
    const video = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'd'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const acc = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 't',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    const created = posts.insert({
      user_id: 'test-user-id',
      video_id: video.id,
      account_id: acc.id,
      scheduled_at: Date.now() + 60_000,
      caption: 'orig',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/schedule/${created.id}`,
      payload: { caption: 'edited' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().caption).toBe('edited');
  });

  it('PATCH /schedule/:id refuses non-pending posts', async () => {
    const video = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'e'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const acc = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 't',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    const created = posts.insert({
      user_id: 'test-user-id',
      video_id: video.id,
      account_id: acc.id,
      scheduled_at: Date.now() + 60_000,
      caption: 'orig',
    });
    posts.markPublished(created.id, 'ext-id');

    const res = await app.inject({
      method: 'PATCH',
      url: `/schedule/${created.id}`,
      payload: { caption: 'try' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /schedule/:id removes pending post', async () => {
    const video = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'f'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const acc = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 't',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    const created = posts.insert({
      user_id: 'test-user-id',
      video_id: video.id,
      account_id: acc.id,
      scheduled_at: Date.now() + 60_000,
      caption: 'c',
    });

    const res = await app.inject({ method: 'DELETE', url: `/schedule/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(posts.findById(created.id)).toBeNull();
  });

  it('GET /schedule lists posts', async () => {
    const res = await app.inject({ method: 'GET', url: '/schedule' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('posts');
  });

  it('GET /dashboard/counts returns status buckets', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/counts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.by_status).toHaveProperty('pending');
    expect(body).toHaveProperty('published_last_7d');
  });

  it('GET /history filters by account_id and date_from', async () => {
    const local = await buildTestApp();
    local.users.insert({
      id: 'test-user-id',
      email: 'test@example.com',
      password_hash: 'hash',
      name: 'Test User',
    });
    const v = local.videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/a.mp4',
      sha256: 'a'.repeat(64),
      size_bytes: 1,
      mime: 'video/mp4',
      duration_sec: 1,
    });
    const a1 = local.accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      external_id: 'A1',
      display_name: 'A1',
      oauth_refresh_token: 'r',
      oauth_access_token: 'a',
      token_expires_at: 0,
      status: 'active',
    });
    const a2 = local.accounts.insert({
      user_id: 'test-user-id',
      platform: 'tiktok',
      external_id: 'A2',
      display_name: 'A2',
      oauth_refresh_token: 'r',
      oauth_access_token: 'a',
      token_expires_at: 0,
      status: 'active',
    });
    local.posts.insert({ user_id: 'test-user-id', video_id: v.id, account_id: a1.id, scheduled_at: 1_000, caption: 'past' });
    const farFuture = 8_000_000_000_000;
    local.posts.insert({ user_id: 'test-user-id', video_id: v.id, account_id: a2.id, scheduled_at: farFuture, caption: 'future' });

    const all = await local.app.inject({ method: 'GET', url: '/history' });
    expect(all.json().posts).toHaveLength(2);

    // account_id filter
    const byAcc = await local.app.inject({ method: 'GET', url: `/history?account_id=${a1.id}` });
    const accRows = byAcc.json().posts;
    expect(accRows).toHaveLength(1);
    expect(accRows[0].account_id).toBe(a1.id);

    // date_from filter (drops the past post). 1_000_000_000ms = 1970-01-12
    // (1_000_000ms is Jan 1, which would always pass).
    const dateFrom = new Date(1_000_000_000).toISOString().slice(0, 10);
    const recent = await local.app.inject({
      method: 'GET',
      url: `/history?date_from=${dateFrom}`,
    });
    expect(recent.json().posts).toHaveLength(1);
    expect(recent.json().posts[0].caption).toBe('future');

    // Combined filter (date_from alone covers all since both rows; account_id
    // narrows to a1's post; date_from combined with account_id drops the
    // a1 past row).
    const combined = await local.app.inject({
      method: 'GET',
      url: `/history?account_id=${a1.id}&date_from=${dateFrom}`,
    });
    expect(combined.json().posts).toHaveLength(0);
    await local.app.close();
  });

  it('GET /dashboard/counts returns status buckets', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/counts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.by_status).toHaveProperty('pending');
    expect(body).toHaveProperty('published_last_7d');
  });
});
