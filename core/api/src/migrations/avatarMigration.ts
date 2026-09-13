/**
 * One-shot migration: refresh avatar_url for existing YouTube accounts.
 *
 * Background: previous versions of `core/api/src/google/realClient.ts`
 * only read `snippet.thumbnails.default.url` (88x88 px). Accounts inserted
 * before the upgrade have `avatar_url=''` in the DB. After upgrading the
 * client to prefer `high`/`medium`/`default`, those legacy rows need a
 * one-time refetch so the SPA can render a sharp avatar.
 *
 * Trigger: API startup, after the DB + accounts repo are constructed but
 * before `app.listen`. Migration is best-effort — each account is processed
 * independently and failures are logged without aborting the boot.
 *
 * Cost: N x 1 YouTube Data API v3 unit (channels.list) for N legacy rows.
 * Migration is idempotent: re-running on already-migrated rows is a no-op
 * because the where-clause filters on `avatar_url=''`.
 *
 * Token handling: same as `POST /accounts/:id/sync` — decrypt the cached
 * access_token; if missing or expired, try the refresh_token; if refresh
 * fails, log + skip (the user must reconnect through OAuth).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { GoogleOAuthClient } from '../google/client.js';
import { decrypt, encrypt } from '@social-auto/shared/utils/crypto.js';
import type { AccountsRepo } from '../repositories/accounts.js';
/**
 * Inputs for {@link migrateAvatars}. The boot sequence in `buildApp`
 * constructs this with the real `GoogleOAuthClient`; tests pass a mock.
 */

export interface AvatarMigrationDeps {
  accounts: AccountsRepo;
  google: GoogleOAuthClient;
  tokenEncryptionKey?: string;
  log: FastifyBaseLogger;
}
/**
 * Find YouTube accounts with empty avatar_url and refetch channel info
 * from Google to populate it. Returns the number of accounts successfully
 * refreshed. Failures are logged per account but never throw — the boot
 * sequence must continue even if Google is unreachable.
 */
export async function migrateAvatars(deps: AvatarMigrationDeps): Promise<number> {
  const { accounts, google, tokenEncryptionKey, log } = deps;
  if (!tokenEncryptionKey) {
    log.warn('avatar migration skipped: TOKEN_ENCRYPTION_KEY not configured');
    return 0;
  }
  const all = accounts.list();
  const stale = all.filter((a) => a.platform === 'youtube' && !a.avatar_url);
  if (stale.length === 0) return 0;
  log.info({ count: stale.length }, 'avatar migration: starting');
  let refreshed = 0;
  for (const row of stale) {
    try {
      const decrypted = await resolveAccessToken({
        row,
        google,
        tokenEncryptionKey,
        accounts,
        log,
      });
      if (!decrypted) continue;
      const info = await google.getMyChannel(decrypted);
      const thumbnail = info.thumbnail_url ?? '';
      if (!thumbnail) {
        log.warn({ account_id: row.id }, 'avatar migration: no thumbnail in response');
        continue;
      }
      accounts.updateChannelSnapshot(row.id, {
        avatar_url: thumbnail,
        // Migration runs through the same Google fetch path as /sync, so
        // stamp the snapshot timestamp. Without this the row would show
        // "Never synced" in the UI even though we just hit the API.
        last_sync_at: info.snapshot_at,
      });
      refreshed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ account_id: row.id, err: msg }, 'avatar migration: failed for account');
    }
  }
  log.info({ refreshed, total: stale.length }, 'avatar migration: done');
  return refreshed;
}

/**
 * Decrypt access_token; if missing or expired, refresh. Returns null if
 * the token cannot be obtained (the caller logs and skips). Side-effect:
 * persists the new access_token after a successful refresh so the next
 * sync doesn't pay the round-trip cost again.
 */
async function resolveAccessToken(args: {
  row: ReturnType<AccountsRepo['list']>[number];
  google: GoogleOAuthClient;
  tokenEncryptionKey: string;
  accounts: AccountsRepo;
  log: FastifyBaseLogger;
}): Promise<string | null> {
  const { row, google, tokenEncryptionKey, accounts, log } = args;
  let access: string | null = null;
  if (row.oauth_access_token) {
    try {
      access = decrypt(row.oauth_access_token, tokenEncryptionKey);
    } catch (err) {
      log.warn({ account_id: row.id }, 'avatar migration: access_token decrypt failed');
      access = null;
    }
  }
  if (access) return access;
  // Fall back to refresh_token.
  try {
    const refresh = decrypt(row.oauth_refresh_token, tokenEncryptionKey);
    const tokens = await google.refresh(refresh);
    accounts.updateTokens(row.id, {
      access_token: encrypt(tokens.access_token, tokenEncryptionKey),
      expires_at: tokens.expires_at,
    });
    return tokens.access_token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ account_id: row.id, err: msg }, 'avatar migration: refresh failed');
    return null;
  }
}
