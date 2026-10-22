import { describe, it, expect, beforeEach } from 'vitest';
import { openDB, type DB } from '../db.js';
import { AccountsRepo } from './accounts.js';
import { VideosRepo } from './videos.js';
import { ScheduledPostsRepo } from './scheduledPosts.js';
let db: DB;
let videos: VideosRepo;
let accounts: AccountsRepo;
let posts: ScheduledPostsRepo;

beforeEach(async () => {
  db = await openDB(':memory:');
  videos = new VideosRepo(db);
  accounts = new AccountsRepo(db);
  posts = new ScheduledPostsRepo(db);
  // 'default-user' is seeded by migration 0011.
});

function makeFixtures(): { videoId: string; accountId: string } {
  const v = videos.insert({
    user_id: 'default-user',
    file_path: '/tmp/clip.mp4',
    sha256: 'a'.repeat(64),
    size_bytes: 1_024,
    mime: 'video/mp4',
    duration_sec: 12,
  });
  const a = accounts.insert({
    user_id: 'default-user',
    platform: 'youtube',
    external_id: 'UC_test',
    display_name: 'Test Channel',
    oauth_refresh_token: 'enc-refresh',
    oauth_access_token: 'enc-access',
    token_expires_at: Date.now() + 3600_000,
    status: 'active',
  });
  return { videoId: v.id, accountId: a.id };
}

function makePost(opts: { videoId: string; accountId: string; updatedAt?: number }): string {
  const now = Date.now();
  const id = `post-${Math.random().toString(36).slice(2, 10)}`;
  const updatedAt = opts.updatedAt ?? now;
  db.raw.run(
    `INSERT INTO scheduled_posts
     (id, user_id, video_id, account_id, scheduled_at, caption, visibility, status,
      retry_count, is_dead, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', 'private', 'uploading', 0, 0, ?, ?)`,
    [id, 'default-user', opts.videoId, opts.accountId, now + 60_000, updatedAt, updatedAt],
  );
  return id;
}

describe('ScheduledPostsRepo.unstickUploading', () => {
  const UNSTICK_MS = 30 * 60 * 1000;
  const now = Date.now();

  it('recovers a stale uploading row back to pending', () => {
    const { videoId, accountId } = makeFixtures();
    const stale = now - UNSTICK_MS - 1_000;
    const id = makePost({ videoId, accountId, updatedAt: stale });
    const requeued = posts.unstickUploading(UNSTICK_MS, now);
    expect(requeued).toBe(1);
    const row = posts.findById(id);
    expect(row?.status).toBe('pending');
    expect(row?.last_error).toBe('worker_crash_recovery');
    expect(row?.retry_count).toBe(1);
  });

  it('leaves fresh uploading rows alone', () => {
    const { videoId, accountId } = makeFixtures();
    const fresh = now - 5_000;
    const id = makePost({ videoId, accountId, updatedAt: fresh });
    const requeued = posts.unstickUploading(UNSTICK_MS, now);
    expect(requeued).toBe(0);
    expect(posts.findById(id)?.status).toBe('uploading');
  });

  it('marks a post dead once it has burned maxRecoveries recoveries', () => {
    const { videoId, accountId } = makeFixtures();
    const stale = now - UNSTICK_MS - 1_000;
    const id = makePost({ videoId, accountId, updatedAt: stale });
    db.raw.run('UPDATE scheduled_posts SET retry_count = 5 WHERE id = ?', [id]);
    posts.unstickUploading(UNSTICK_MS, now, /*maxRecoveries*/ 5);
    const row = posts.findById(id);
    expect(row?.status).toBe('dead');
    expect(row?.is_dead).toBe(true);
    expect(row?.last_error).toBe('worker_recovery_exhausted');
  });

  it('returns the count of requeued rows (not the dead-marked count)', () => {
    const { videoId, accountId } = makeFixtures();
    const stale = now - UNSTICK_MS - 1_000;
    const a = makePost({ videoId, accountId, updatedAt: stale });
    const b = makePost({ videoId, accountId, updatedAt: stale });
    const dead = makePost({ videoId, accountId, updatedAt: stale });
    db.raw.run('UPDATE scheduled_posts SET retry_count = 5 WHERE id = ?', [dead]);
    const requeued = posts.unstickUploading(UNSTICK_MS, now, /*maxRecoveries*/ 5);
    expect(requeued).toBe(2);
    expect(posts.findById(a)?.status).toBe('pending');
    expect(posts.findById(b)?.status).toBe('pending');
    expect(posts.findById(dead)?.status).toBe('dead');
  });
});