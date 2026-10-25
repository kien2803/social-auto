import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'sql.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDB, type DB } from '../db.js';
import { VideosRepo } from '../repositories/videos.js';
import { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import { AccountsRepo } from '../repositories/accounts.js';
import { QuotasRepo } from '../repositories/quotas.js';
import { UsersRepo } from '../repositories/users.js';
import { encrypt } from '@social-auto/shared/utils/crypto.js';

const TOKEN_KEY = 'a'.repeat(64);

describe('ScheduledPostsRepo + QuotasRepo', () => {
  let db: DB;
  let videos: VideosRepo;
  let accounts: AccountsRepo;
  let posts: ScheduledPostsRepo;
  let quotas: QuotasRepo;
  let users: UsersRepo;

  beforeEach(async () => {
    db = await openDB(':memory:');
    users = new UsersRepo(db);
    videos = new VideosRepo(db);
    accounts = new AccountsRepo(db);
    posts = new ScheduledPostsRepo(db);
    quotas = new QuotasRepo(db);
    // Create test user
    users.insert({
      id: 'test-user-id',
      email: 'test@example.com',
      password_hash: 'hash',
      name: 'Test User',
    });
  });

  function makeFixtures() {
    const v = videos.insert({
      user_id: 'test-user-id',
      file_path: '/tmp/x.mp4',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      mime: 'video/mp4',
    });
    const a = accounts.insert({
      user_id: 'test-user-id',
      platform: 'youtube',
      display_name: 't',
      oauth_refresh_token: encrypt('rt', TOKEN_KEY),
      status: 'active',
    });
    return { v, a };
  }

  it('claimDuePosts only picks pending posts past scheduled_at', async () => {
    const { v, a } = makeFixtures();
    const now = Date.now();
    const past = posts.insert({
      video_id: v.id,
      account_id: a.id,
      scheduled_at: now - 1000,
      caption: 'c',
    });
    posts.insert({
      video_id: v.id,
      account_id: a.id,
      scheduled_at: now + 60_000,
      caption: 'future',
    });

    const claimed = posts.claimDuePosts(now);
    expect(claimed).toHaveLength(1);
    const first = claimed[0]!;
    expect(first.id).toBe(past.id);
    expect(first.status).toBe('uploading');
  });

  it('claimDuePosts works on a file-backed DB (persist/export must not erase the claim)', async () => {
    // Regression: instrumentWrites persists on every write for file-backed
    // DBs, and sql.js export() resets sqlite3_changes(). If the claim UPDATE's
    // rowsModified check reads the counter after export, it sees 0 and the
    // claim is silently dropped — leaving the post 'uploading' forever.
    const dir = mkdtempSync(join(tmpdir(), 'social-auto-test-'));
    const fileDb = await openDB(join(dir, 'app.db'));
    try {
      const u2 = new UsersRepo(fileDb);
      const v2 = new VideosRepo(fileDb);
      const a2 = new AccountsRepo(fileDb);
      const p2 = new ScheduledPostsRepo(fileDb);
      u2.insert({ id: 'u2', email: 'u2@x.com', password_hash: 'h', name: 'u' });
      const v = v2.insert({
        user_id: 'u2',
        file_path: '/tmp/x.mp4',
        sha256: 'b'.repeat(64),
        size_bytes: 1,
        mime: 'video/mp4',
      });
      const a = a2.insert({
        user_id: 'u2',
        platform: 'tiktok',
        display_name: 't',
        oauth_refresh_token: encrypt('rt', TOKEN_KEY),
        status: 'active',
      });
      const post = p2.insert({
        video_id: v.id,
        account_id: a.id,
        scheduled_at: Date.now() - 1000,
        caption: 'c',
      });
      const claimed = p2.claimDuePosts(Date.now());
      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.id).toBe(post.id);
    } finally {
      fileDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('claimDuePosts skips posts in retry backoff', async () => {
    const { v, a } = makeFixtures();
    const now = Date.now();
    const p = posts.insert({
      video_id: v.id,
      account_id: a.id,
      scheduled_at: now - 1000,
      caption: 'c',
    });
    posts.scheduleRetry(p.id, 'fake_err', now, 5);
    expect(posts.claimDuePosts(now)).toHaveLength(0);
  });

  it('scheduleRetry marks dead after max retries', async () => {
    const { v, a } = makeFixtures();
    const p = posts.insert({
      video_id: v.id,
      account_id: a.id,
      scheduled_at: Date.now() - 1000,
      caption: 'c',
    });
    for (let i = 0; i < 5; i++) {
      posts.scheduleRetry(p.id, `err_${i}`, Date.now(), 5);
    }
    const after = posts.findById(p.id);
    expect(after?.is_dead).toBe(true);
    expect(after?.status).toBe('dead');
  });

  it('unstickUploading recovers rows stuck >30 min', async () => {
    const { v, a } = makeFixtures();
    const now = Date.now();
    const p = posts.insert({
      video_id: v.id,
      account_id: a.id,
      scheduled_at: now - 1000,
      caption: 'c',
    });
    // Simulate worker crash: row was set to 'uploading' long ago.
    const raw: Database = db.raw;
    raw.run(`UPDATE scheduled_posts SET status = 'uploading', updated_at = ? WHERE id = ?`, [
      now - 60 * 60 * 1000,
      p.id,
    ]);
    const recovered = posts.unstickUploading(30 * 60 * 1000, now);
    expect(recovered).toBeGreaterThanOrEqual(1);
    const after = posts.findById(p.id);
    expect(after?.status).toBe('pending');
  });

  it('QuotasRepo tracks daily usage', () => {
    const now = Date.now();
    expect(quotas.get('youtube', now).used).toBe(0);
    quotas.incrementUsage('youtube', 1600, now);
    quotas.incrementUsage('youtube', 1600, now);
    expect(quotas.get('youtube', now).used).toBe(3200);
    expect(quotas.hasRemaining('youtube', now)).toBe(true);
    quotas.incrementUsage('youtube', 10000, now);
    expect(quotas.hasRemaining('youtube', now)).toBe(false);
  });

  it('findBySha256 dedups per-user, not globally', () => {
    users.insert({
      id: 'user-b',
      email: 'b@example.com',
      password_hash: 'hash',
      name: 'User B',
    });
    const sha = 'c'.repeat(64);
    const vA = videos.insert({
      user_id: 'test-user-id',
      file_path: `/tmp/${sha}.mp4`,
      sha256: sha,
      size_bytes: 1,
      mime: 'video/mp4',
    });
    // Same content, different user → no dedup hit.
    expect(videos.findBySha256(sha, 'test-user-id')?.id).toBe(vA.id);
    expect(videos.findBySha256(sha, 'user-b')).toBeNull();
    expect(videos.countBySha256(sha)).toBe(1);

    videos.insert({
      user_id: 'user-b',
      file_path: `/tmp/${sha}.mp4`,
      sha256: sha,
      size_bytes: 1,
      mime: 'video/mp4',
    });
    expect(videos.countBySha256(sha)).toBe(2);
  });

  it('deleting an account cascades to its scheduled posts (FK ON DELETE CASCADE)', () => {
    const { v, a } = makeFixtures();
    posts.insert({
      video_id: v.id,
      account_id: a.id,
      scheduled_at: Date.now() + 60_000,
      caption: 'cascade me',
    });
    // Sanity: one pending post exists before delete.
    expect(
      db.raw.exec('SELECT id FROM scheduled_posts WHERE account_id = ?', [a.id])[0]
        ?.values.length,
    ).toBe(1);

    accounts.deleteById(a.id);

    // The scheduled post must be gone too — otherwise the FK was added
    // without ON DELETE CASCADE and a real disconnect flow would surface
    // a 500 the moment a user with pending posts tries to remove an
    // account (see API-001 in the audit).
    const remaining = db.raw.exec(
      'SELECT id FROM scheduled_posts WHERE account_id = ?',
      [a.id],
    );
    expect(remaining[0]?.values.length ?? 0).toBe(0);
  });
});
