/**
 * Tests for `AccountsRepo.updateChannelSnapshot`. Verifies the batch-write
 * contract: any subset of AccountChannelSnapshot fields can be patched,
 * omitted fields keep their prior value, and a single UPDATE statement
 * is emitted (so this can be observed from write counts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB, type DB } from '../db.js';
import { AccountsRepo } from './accounts.js';
import { UsersRepo } from './users.js';
import { encrypt } from '@social-auto/shared/utils/crypto.js';

const TOKEN_KEY = 'a'.repeat(64);

async function buildFixture(): Promise<{ db: DB; accounts: AccountsRepo; id: string }> {
  const db = await openDB(':memory:');
  const users = new UsersRepo(db);
  const accounts = new AccountsRepo(db);
  // Create test user
  users.insert({
    id: 'test-user-id',
    email: 'test@example.com',
    password_hash: 'hash',
    name: 'Test User',
  });
  const row = accounts.insert({
    user_id: 'test-user-id',
    platform: 'youtube',
    external_id: 'UC_test',
    display_name: 'Test',
    oauth_refresh_token: encrypt('rt', TOKEN_KEY),
    status: 'active',
  });
  return { db, accounts, id: row.id };
}

describe('AccountsRepo.updateChannelSnapshot', () => {
  let accounts: AccountsRepo;
  let id: string;

  beforeEach(async () => {
    ({ accounts, id } = await buildFixture());
  });

  it('writes only the fields in the patch, leaving others unchanged', () => {
    accounts.updateChannelSnapshot(id, {
      avatar_url: 'https://example.com/a.jpg',
      subscribers: 42,
    });
    const row = accounts.findById(id)!;
    expect(row.avatar_url).toBe('https://example.com/a.jpg');
    expect(row.subscribers).toBe(42);
    // Omitted fields keep defaults (empty / null).
    expect(row.channel_handle).toBe('');
    expect(row.views).toBeNull();
    expect(row.video_count).toBeNull();
    expect(row.last_sync_at).toBeNull();
  });

  it('writes last_sync_at without touching subscribers', () => {
    accounts.updateChannelSnapshot(id, { subscribers: 100 });
    accounts.updateChannelSnapshot(id, { last_sync_at: 1_700_000_000_000 });
    const row = accounts.findById(id)!;
    expect(row.subscribers).toBe(100);
    expect(row.last_sync_at).toBe(1_700_000_000_000);
  });

  it('accepts an empty patch without throwing and writes nothing', () => {
    accounts.updateChannelSnapshot(id, {});
    const row = accounts.findById(id)!;
    expect(row.avatar_url).toBe('');
    expect(row.subscribers).toBeNull();
  });

  it('persists all snapshot fields when passed in full', () => {
    accounts.updateChannelSnapshot(id, {
      channel_handle: '@handle',
      avatar_url: 'https://example.com/avatar.jpg',
      subscribers: 12345,
      views: 67890,
      video_count: 12,
      like_count: 345,
      avg_watch_seconds: 240,
      drop_off_pct: 0.42,
      last_sync_at: 1_700_000_000_000,
    });
    const row = accounts.findById(id)!;
    expect(row.channel_handle).toBe('@handle');
    expect(row.avatar_url).toBe('https://example.com/avatar.jpg');
    expect(row.subscribers).toBe(12345);
    expect(row.views).toBe(67890);
    expect(row.video_count).toBe(12);
    expect(row.like_count).toBe(345);
    expect(row.avg_watch_seconds).toBe(240);
    expect(row.drop_off_pct).toBeCloseTo(0.42);
    expect(row.last_sync_at).toBe(1_700_000_000_000);
  });

  it('emits exactly one UPDATE statement regardless of patch size', () => {
    // Spy on db.raw.run by wrapping it: count only the UPDATE statements
    // touching the accounts table. The schema CREATE + the INSERT for the
    // fixture run before the patch, so we record from here on.
    const updates: string[] = [];
    const db = (accounts as unknown as { db: DB }).db;
    const originalRun = db.raw.run.bind(db.raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.raw.run = ((sql: string, _params?: any): unknown => {
      if (sql.includes('UPDATE accounts')) updates.push(sql);
      return originalRun(sql, _params);
    }) as typeof db.raw.run;
    accounts.updateChannelSnapshot(id, {
      avatar_url: 'https://example.com/a.jpg',
      subscribers: 42,
      views: 99,
      video_count: 5,
      last_sync_at: 1_700_000_000_000,
    });
    db.raw.run = originalRun;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/UPDATE accounts SET avatar_url = \?, subscribers = \?, views = \?, video_count = \?, last_sync_at = \? WHERE id = \?/);
  });
});
