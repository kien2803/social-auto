/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures use loose JSON shapes */
/**
 * Tests for `migrateAvatars` — verifies the one-shot migration logic
 * without booting Fastify. Uses an in-memory SQLite + mock Google client
 * so we can assert:
 *   - empty avatar rows are populated
 *   - rows with avatars are left alone (idempotent)
 *   - non-YouTube accounts are skipped
 *   - token refresh fallback works
 *   - Google errors don't abort the whole migration
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from '../db.js';
import { AccountsRepo } from '../repositories/accounts.js';
import { migrateAvatars } from './avatarMigration.js';
import { encrypt } from '@social-auto/shared/utils/crypto.js';
const TOKEN_KEY = 'a'.repeat(64);
interface MockGoogle {
  getMyChannel: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
}
// Cast helper: vi.fn() returns Mock<[], unknown>, which doesn't satisfy
// the function signatures on GoogleOAuthClient. The migration only calls
// `getMyChannel(token)` and `refresh(token)`, so an `any` cast is fine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asGoogle = (g: MockGoogle): any => g;

function makeMockGoogle(): MockGoogle {
  // The Mock type is intentionally permissive — vi.fn returns Mock<any[]>
  // which doesn't satisfy the function signatures on GoogleOAuthClient.
  // We expose the methods as `Mock` here and cast at use sites.
  return {
    getMyChannel: vi.fn(async () => ({
      id: 'UC_mock',
      title: 'Mock Channel',
      handle: '@mock',
      thumbnail_url: 'https://example.com/avatar-high.jpg',
      subscribers: 100,
      views: 1000,
      video_count: 5,
      snapshot_at: Date.now(),
    })) as unknown as ReturnType<typeof vi.fn>,
    refresh: vi.fn(async () => ({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_at: Date.now() + 3600 * 1000,
    })) as unknown as ReturnType<typeof vi.fn>,
  };
}

async function buildFixture(): Promise<{
  accounts: AccountsRepo;
  google: MockGoogle;
}> {
  const db = await openDB(':memory:');
  const accounts = new AccountsRepo(db);
  accounts.insert({
    platform: 'youtube',
    external_id: 'UC_empty',
    display_name: 'Empty Avatar',
    oauth_refresh_token: encrypt('rt', TOKEN_KEY),
    oauth_access_token: encrypt('at', TOKEN_KEY),
    token_expires_at: Date.now() + 3600 * 1000,
    status: 'active',
  });
  accounts.insert({
    platform: 'youtube',
    external_id: 'UC_filled',
    display_name: 'Filled Avatar',
    oauth_refresh_token: encrypt('rt', TOKEN_KEY),
    oauth_access_token: encrypt('at', TOKEN_KEY),
    token_expires_at: Date.now() + 3600 * 1000,
    status: 'active',
  });
  // Simulate the "filled" row by re-saving with avatar populated.
  accounts.updateChannelSnapshot(
    accounts.list().find((a) => a.external_id === 'UC_filled')!.id,
    { avatar_url: 'https://example.com/existing.jpg' },
  );
  accounts.insert({
    platform: 'tiktok',
    external_id: 'tt_1',
    display_name: 'TikTok User',
    oauth_refresh_token: encrypt('rt', TOKEN_KEY),
    oauth_access_token: encrypt('at', TOKEN_KEY),
    status: 'active',
  });
  // YouTube row with no access_token (forces refresh path).
  accounts.insert({
    platform: 'youtube',
    external_id: 'UC_refresh',
    display_name: 'Needs Refresh',
    oauth_refresh_token: encrypt('rt-refresh', TOKEN_KEY),
    oauth_access_token: null,
    token_expires_at: null,
    status: 'active',
  });
  return { accounts, google: makeMockGoogle() };
}

describe('migrateAvatars', () => {
  let accounts: AccountsRepo;
  let google: MockGoogle;
  // consoleWarn is typed loosely because FastifyBaseLogger['warn'] is
  // overloaded and vi.spyOn's MockInstance type isn't compatible with it
  // when we pass it through migrateAvatars' log parameter.
  let consoleWarn: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    ({ accounts, google } = await buildFixture());
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
  });
  it('skips when TOKEN_ENCRYPTION_KEY is missing', async () => {
    const refreshed = await migrateAvatars({
      accounts,
      google: asGoogle(google),
      log: { warn: consoleWarn, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    expect(refreshed).toBe(0);
    expect(google.getMyChannel).not.toHaveBeenCalled();
  });

  it('populates avatar_url for rows where it is empty', async () => {
    const refreshed = await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    expect(refreshed).toBe(2);
    const empty = accounts.findByPlatformExternal('youtube', 'UC_empty')!;
    expect(empty.avatar_url).toBe('https://example.com/avatar-high.jpg');
  });

  it('leaves rows that already have an avatar alone (idempotent)', async () => {
    await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    const filled = accounts.findByPlatformExternal('youtube', 'UC_filled')!;
    expect(filled.avatar_url).toBe('https://example.com/existing.jpg');
  });

  it('skips non-YouTube accounts', async () => {
    await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    const tt = accounts.findByPlatformExternal('tiktok', 'tt_1')!;
    expect(tt.avatar_url).toBe('');
    // google.getMyChannel should be called only for YouTube rows (3: empty, filled-skipped, refresh).
    // Filled was skipped because avatar was set; refresh went through refresh().
    expect(google.getMyChannel).toHaveBeenCalledTimes(2);
  });

  it('stamps last_sync_at so the UI reflects that we hit Google', async () => {
    await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    const empty = accounts.findByPlatformExternal('youtube', 'UC_empty')!;
    expect(empty.avatar_url).toBe('https://example.com/avatar-high.jpg');
    expect(empty.last_sync_at).toBeGreaterThan(0);
  });

  it('falls back to refresh_token when access_token is missing', async () => {
    await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    const refreshRow = accounts.findByPlatformExternal('youtube', 'UC_refresh')!;
    expect(refreshRow.avatar_url).toBe('https://example.com/avatar-high.jpg');
    expect(google.refresh).toHaveBeenCalledWith('rt-refresh');
  });

  it('continues past a Google API error on one row', async () => {
    (google.getMyChannel as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('google_500'));
    const refreshed = await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: consoleWarn, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    // 3 attempted: empty, filled-skipped (no call), refresh. Of those, empty
    // failed, refresh succeeded. So 1 refreshed total.
    expect(refreshed).toBe(1);
    const empty = accounts.findByPlatformExternal('youtube', 'UC_empty')!;
    expect(empty.avatar_url).toBe('');
    const refreshRow = accounts.findByPlatformExternal('youtube', 'UC_refresh')!;
    expect(refreshRow.avatar_url).toBe('https://example.com/avatar-high.jpg');
  });

  it('returns 0 when no rows need migration', async () => {
    // Mark all YouTube rows as already having avatars.
    for (const a of accounts.list().filter((x) => x.platform === 'youtube')) {
      accounts.updateChannelSnapshot(a.id, { avatar_url: 'https://x.test/x.jpg' });
    }
    const refreshed = await migrateAvatars({
      accounts,
      google: asGoogle(google),
      tokenEncryptionKey: TOKEN_KEY,
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });
    expect(refreshed).toBe(0);
    expect(google.getMyChannel).not.toHaveBeenCalled();
  });
});
