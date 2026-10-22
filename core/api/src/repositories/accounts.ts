import type {
  AccountChannelSnapshot,
  AccountLanguageCode,
  AccountMetadata,
  AccountRow,
  Platform,
} from '@social-auto/shared';
import type { DB } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface NewAccount {
  user_id?: string;
  platform: Platform;
  /** Stable identifier returned by the platform (YouTube channel id, IG user id, …). Unique per platform. Optional for back-compat with fixtures and for platforms whose stable id is not yet wired; defaults to ''. */
  external_id?: string;
  display_name: string;
  oauth_refresh_token: string;
  oauth_access_token?: string | null;
  token_expires_at?: number | null;
  status?: AccountRow['status'];
  metadata?: Partial<AccountMetadata>;
  channel?: Partial<AccountChannelSnapshot>;
}

function defaultMetadata(overrides?: Partial<AccountMetadata>): AccountMetadata {
  return {
    content_category: overrides?.content_category ?? '',
    language_code: (overrides?.language_code ?? '') as AccountLanguageCode,
    purpose: overrides?.purpose ?? '',
    link: overrides?.link ?? '',
  };
}

function defaultChannel(overrides?: Partial<AccountChannelSnapshot>): AccountChannelSnapshot {
  return {
    channel_handle: overrides?.channel_handle ?? '',
    avatar_url: overrides?.avatar_url ?? '',
    subscribers: overrides?.subscribers ?? null,
    views: overrides?.views ?? null,
    video_count: overrides?.video_count ?? null,
    like_count: overrides?.like_count ?? null,
    avg_watch_seconds: overrides?.avg_watch_seconds ?? null,
    drop_off_pct: overrides?.drop_off_pct ?? null,
    last_sync_at: overrides?.last_sync_at ?? null,
  };
}

/**
 * Convert a sql.js row (array of values) to a typed object by column order.
 * The schema's CREATE TABLE for `accounts` lists columns in this order:
 *   id, user_id, platform, external_id, display_name, oauth_refresh_token,
 *   oauth_access_token, token_expires_at, status, created_at,
 *   content_category, language_code, purpose, link,
 *   channel_handle, avatar_url, subscribers, views, video_count,
 *   like_count, avg_watch_seconds, drop_off_pct, last_sync_at
 * `SELECT *` returns columns in that same order. The previous version of
 * this mapper had `display_name` at position 2 (pre-schema-version 2
 * layout) but the schema had moved `external_id` into position 2; the
 * mismatch meant every account read had `display_name` come back as a
 * number (`created_at`) and `status` come back as the string 'active'
 * (from position 7). The wire mapper at routes/accounts.ts#toWire
 * faithfully forwarded the broken shape, so the UI displayed a date
 * where the channel name should have been. THIS must stay in sync with
 * core/worker/src/repositories/accounts.ts and the SCHEMA_SQL definition
 * in core/packages/shared/src/db/schema.ts.
 */
function rowToAccount(row: unknown[]): AccountRow {
  return {
    id: row[0] as string,
    user_id: row[1] as string,
    platform: row[2] as Platform,
    external_id: (row[3] as string | null) ?? '',
    display_name: row[4] as string,
    oauth_refresh_token: row[5] as string,
    oauth_access_token: (row[6] as string | null) ?? null,
    token_expires_at: (row[7] as number | null) ?? null,
    status: row[8] as AccountRow['status'],
    created_at: row[9] as number,
    content_category: (row[10] as string | null) ?? '',
    language_code: (row[11] as string | null) ?? '',
    purpose: (row[12] as string | null) ?? '',
    link: (row[13] as string | null) ?? '',
    channel_handle: (row[14] as string | null) ?? '',
    avatar_url: (row[15] as string | null) ?? '',
    subscribers: (row[16] as number | null) ?? null,
    views: (row[17] as number | null) ?? null,
    video_count: (row[18] as number | null) ?? null,
    like_count: (row[19] as number | null) ?? null,
    avg_watch_seconds: (row[20] as number | null) ?? null,
    drop_off_pct: (row[21] as number | null) ?? null,
    last_sync_at: (row[22] as number | null) ?? null,
  };
}

/**
 * Slim variant of rowToAccount for the projection used by listSlim. The
 * SELECT in listSlim omits the encrypted token columns and reorders the
 * remaining 19 columns, so the slot indices here MUST stay in lock-step
 * with that SELECT (see comment in listSlim). The full mapper above would
 * read the wrong values for status / display_name / created_at otherwise.
 */
function rowToSlimAccount(row: unknown[]): AccountRow {
  return {
    id: row[0] as string,
    user_id: row[1] as string,
    platform: row[2] as Platform,
    external_id: (row[3] as string | null) ?? '',
    display_name: row[4] as string,
    status: row[5] as AccountRow['status'],
    created_at: row[6] as number,
    content_category: (row[7] as string | null) ?? '',
    language_code: (row[8] as string | null) ?? '',
    purpose: (row[9] as string | null) ?? '',
    link: (row[10] as string | null) ?? '',
    channel_handle: (row[11] as string | null) ?? '',
    avatar_url: (row[12] as string | null) ?? '',
    subscribers: (row[13] as number | null) ?? null,
    views: (row[14] as number | null) ?? null,
    video_count: (row[15] as number | null) ?? null,
    like_count: (row[16] as number | null) ?? null,
    avg_watch_seconds: (row[17] as number | null) ?? null,
    drop_off_pct: (row[18] as number | null) ?? null,
    last_sync_at: (row[19] as number | null) ?? null,
    oauth_refresh_token: '',
    oauth_access_token: null,
    token_expires_at: null,
  };
}

 const INSERT_SQL = `INSERT INTO accounts
 (id, user_id, platform, external_id, display_name, oauth_refresh_token, oauth_access_token,
  token_expires_at, status, created_at,
  content_category, language_code, purpose, link,
  channel_handle, avatar_url, subscribers, views, video_count,
  like_count, avg_watch_seconds, drop_off_pct, last_sync_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export interface ListFilter {
  userId?: string;
  search?: string;
  platform?: Platform;
  status?: AccountRow['status'];
  contentCategory?: string;
  languageCode?: AccountLanguageCode;
}

export class AccountsRepo {
  constructor(private db: DB) {}

  insert(input: NewAccount): AccountRow {
    const metadata = defaultMetadata(input.metadata);
    const channel = defaultChannel(input.channel);
    const row: AccountRow = {
      id: randomUUID(),
      user_id: input.user_id ?? 'default-user',
      platform: input.platform,
      // external_id is the platform-stable id (e.g. YouTube channel id). OAuth
      // callbacks always supply it; fixtures and tests may not. An empty string
      // is a safe placeholder — the UNIQUE (platform, external_id) index treats
      // it as a real value, so two fixtures with no external_id on the same
      // platform would collide, but in practice no fixture inserts twice.
      external_id: input.external_id ?? '',
      display_name: input.display_name,
      oauth_refresh_token: input.oauth_refresh_token,
      oauth_access_token: input.oauth_access_token ?? null,
      token_expires_at: input.token_expires_at ?? null,
      status: input.status ?? 'active',
      created_at: Date.now(),
      content_category: metadata.content_category,
      language_code: metadata.language_code,
      purpose: metadata.purpose,
      link: metadata.link,
      channel_handle: channel.channel_handle,
      avatar_url: channel.avatar_url,
      subscribers: channel.subscribers,
      views: channel.views,
      video_count: channel.video_count,
      like_count: channel.like_count,
      avg_watch_seconds: channel.avg_watch_seconds,
      drop_off_pct: channel.drop_off_pct,
      last_sync_at: channel.last_sync_at,
    };
    this.db.raw.run(INSERT_SQL, [
      row.id,
      row.user_id,
      row.platform,
      row.external_id,
      row.display_name,
      row.oauth_refresh_token,
      row.oauth_access_token,
      row.token_expires_at,
      row.status,
      row.created_at,
      row.content_category,
      row.language_code,
      row.purpose,
      row.link,
      row.channel_handle,
      row.avatar_url,
      row.subscribers,
      row.views,
      row.video_count,
      row.like_count,
      row.avg_watch_seconds,
      row.drop_off_pct,
      row.last_sync_at,
    ]);
    return row;
  }

  /** Lookup by (platform, external_id). Used by the OAuth callback to detect reconnects vs new accounts. */
  findByPlatformExternal(platform: Platform, externalId: string): AccountRow | null {
    const result = this.db.raw.exec(
      'SELECT * FROM accounts WHERE platform = ? AND external_id = ? LIMIT 1',
      [platform, externalId],
    );
    const first = result[0]?.values[0];
    return first ? rowToAccount(first) : null;
  }

  /** Lookup by primary key. */
  findById(id: string): AccountRow | null {
    const result = this.db.raw.exec('SELECT * FROM accounts WHERE id = ?', [id]);
    const first = result[0]?.values[0];
    return first ? rowToAccount(first) : null;
  }

  /** All accounts on a platform, oldest first. */
  listByPlatform(platform: Platform): AccountRow[] {
    const result = this.db.raw.exec(
      'SELECT * FROM accounts WHERE platform = ? ORDER BY created_at ASC',
      [platform],
    );
    const values = result[0]?.values ?? [];
    return values.map(rowToAccount);
  }

  /**
   * Filtered account list. Empty / undefined filters are no-ops. `search`
   * matches case-insensitive substrings on display_name, external_id,
   * purpose, link, or content_category — never on any token field.
   */
  list(filter: ListFilter = {}): AccountRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.userId) {
      where.push('user_id = ?');
      params.push(filter.userId);
    }
    if (filter.platform) {
      where.push('platform = ?');
      params.push(filter.platform);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.contentCategory !== undefined && filter.contentCategory !== '') {
      where.push('content_category = ?');
      params.push(filter.contentCategory);
    }
    if (filter.languageCode !== undefined && filter.languageCode !== '') {
      where.push('language_code = ?');
      params.push(filter.languageCode);
    }
    if (filter.search) {
      const like = `%${filter.search}%`;
      where.push(
        '(display_name LIKE ? OR external_id LIKE ? OR purpose LIKE ? OR link LIKE ? OR content_category LIKE ?)',
      );
      params.push(like, like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = this.db.raw.exec(
      `SELECT * FROM accounts ${whereSql} ORDER BY created_at ASC`,
      params as (string | number | null)[],
    );
    return (result[0]?.values ?? []).map(rowToAccount);
  }
  /**
   * Slim variant of list() that skips encrypted token columns. The wire
   * shape (AccountRow) still requires every field, so this returns the
   * same AccountRow type but with token slots filled with empty strings.
   * Skipping the AES-GCM decrypt on the read path saves significant time
   * for the list / health / CSV export endpoints where the caller never
   * needs the refresh token.
   *
   * The slim path is a separate query rather than a post-fetch transform
   * so the SQL engine never deserializes the (potentially large) ciphertext
   * column at all.
   */
  listSlim(filter: ListFilter = {}): AccountRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.userId) {
      where.push('user_id = ?');
      params.push(filter.userId);
    }
    if (filter.platform) {
      where.push('platform = ?');
      params.push(filter.platform);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.contentCategory !== undefined && filter.contentCategory !== '') {
      where.push('content_category = ?');
      params.push(filter.contentCategory);
    }
    if (filter.languageCode !== undefined && filter.languageCode !== '') {
      where.push('language_code = ?');
      params.push(filter.languageCode);
    }
    if (filter.search) {
      const like = `%${filter.search}%`;
      where.push(
        '(display_name LIKE ? OR external_id LIKE ? OR purpose LIKE ? OR link LIKE ? OR content_category LIKE ?)',
      );
      params.push(like, like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = this.db.raw.exec(
      `SELECT id, user_id, platform, external_id, display_name, status, created_at,
              content_category, language_code, purpose, link,
              channel_handle, avatar_url, subscribers, views, video_count,
              like_count, avg_watch_seconds, drop_off_pct, last_sync_at
       FROM accounts ${whereSql} ORDER BY created_at ASC`,
      params as (string | number | null)[],
    );
    return (result[0]?.values ?? []).map((row) => rowToSlimAccount(row));
  }

  updateStatus(id: string, status: AccountRow['status']): void {


    this.db.raw.run('UPDATE accounts SET status = ? WHERE id = ?', [status, id]);
  }

  /**
   * Transfer an account row to a different user. OAuth callbacks call this
   * when the connected channel/page is already claimed under another
   * user_id — completing the OAuth grant proves control of the channel, so
   * the row follows the most recent connector.
   */
  reassignOwner(id: string, userId: string): void {
    this.db.raw.run('UPDATE accounts SET user_id = ? WHERE id = ?', [userId, id]);
  }

  /** Update the human-readable label (e.g. after the user renames their channel). */
  updateDisplayName(id: string, displayName: string): void {
    this.db.raw.run('UPDATE accounts SET display_name = ? WHERE id = ?', [displayName, id]);
  }

  updateTokens(
    id: string,
    patch: { access_token: string | null; expires_at: number | null },
  ): void {
    this.db.raw.run(
      'UPDATE accounts SET oauth_access_token = ?, token_expires_at = ? WHERE id = ?',
      [patch.access_token, patch.expires_at, id],
    );
  }

  /**
   * Patch user-supplied metadata. Undefined fields are left untouched; null
   * clears them. The caller is responsible for validating length / enum
   * values — this method writes whatever it is given.
   */
  updateMetadata(id: string, patch: Partial<AccountMetadata>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.content_category !== undefined) {
      sets.push('content_category = ?');
      params.push(patch.content_category);
    }
    if (patch.language_code !== undefined) {
      sets.push('language_code = ?');
      params.push(patch.language_code);
    }
    if (patch.purpose !== undefined) {
      sets.push('purpose = ?');
      params.push(patch.purpose);
    }
    if (patch.link !== undefined) {
      sets.push('link = ?');
      params.push(patch.link);
    }
    if (!sets.length) return;
    params.push(id);
    this.db.raw.run(
      `UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`,
      params as (string | number | null)[],
    );
  }

  /**
   * Persist the YouTube channel stats snapshot fetched from the Data API.
   * Pass an empty object to clear all channel fields back to defaults.
   * Issues a single UPDATE statement regardless of how many fields the
   * caller passes — the previous per-field update loop ran one DB write
   * per non-undefined field, which made sync / avatar migration O(N) writes
   * per account. Only fields explicitly included in the patch are written;
   * omitted fields keep their current value.
   */
  updateChannelSnapshot(id: string, snapshot: Partial<AccountChannelSnapshot>): void {
    const colKeys: Array<keyof AccountChannelSnapshot> = [
      'channel_handle',
      'avatar_url',
      'subscribers',
      'views',
      'video_count',
      'like_count',
      'avg_watch_seconds',
      'drop_off_pct',
      'last_sync_at',
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of colKeys) {
      const value = snapshot[col];
      if (value === undefined) continue;
      sets.push(`${String(col)} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.raw.run(
      `UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`,
      params as (string | number | null)[],
    );
  }

  /**
   * Permanently remove an account row. Used when the user reconnects and the
   * previous row is no longer relevant (e.g. the previous refresh token is
   * dead because the OAuth grant was revoked).
   */
  deleteById(id: string): void {
    this.db.raw.run('DELETE FROM accounts WHERE id = ?', [id]);
  }

}
