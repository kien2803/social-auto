import type { AccountRow, Platform } from '@social-auto/shared';
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
}

/**
 * Convert a sql.js row (array of values) to a typed object by column order.
 * The schema's CREATE TABLE for `accounts` lists columns in this order:
 *   id, user_id, platform, external_id, display_name, oauth_refresh_token,
 *   oauth_access_token, token_expires_at, status, created_at,
 *   content_category, language_code, purpose, link,
 *   channel_handle, avatar_url, subscribers, views, video_count,
 *   like_count, avg_watch_seconds, drop_off_pct, last_sync_at
 * `SELECT *` returns columns in that same order. THIS must stay in sync with
 * core/api/src/repositories/accounts.ts since the API may have written
 * the row and the worker reads it back.
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

const INSERT_SQL = `INSERT INTO accounts
 (id, user_id, platform, external_id, display_name, oauth_refresh_token, oauth_access_token, token_expires_at, status, created_at,
  content_category, language_code, purpose, link,
  channel_handle, avatar_url, subscribers, views, video_count,
  like_count, avg_watch_seconds, drop_off_pct, last_sync_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export class AccountsRepo {
  constructor(private db: DB) {}

  insert(input: NewAccount): AccountRow {
    const row: AccountRow = {
      id: randomUUID(),
      user_id: input.user_id ?? 'default-user',
      platform: input.platform,
      // external_id is the platform-stable id. OAuth callbacks always supply
      // it; fixtures and tests may not. Empty string is a safe placeholder —
      // see api/src/repositories/accounts.ts for the same rationale.
      external_id: input.external_id ?? '',
      display_name: input.display_name,
      oauth_refresh_token: input.oauth_refresh_token,
      oauth_access_token: input.oauth_access_token ?? null,
      token_expires_at: input.token_expires_at ?? null,
      status: input.status ?? 'active',
      created_at: Date.now(),
      content_category: '',
      language_code: '',
      purpose: '',
      link: '',
      channel_handle: '',
      avatar_url: '',
      subscribers: null,
      views: null,
      video_count: null,
      like_count: null,
      avg_watch_seconds: null,
      drop_off_pct: null,
      last_sync_at: null,
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

  findById(id: string): AccountRow | null {
    const result = this.db.raw.exec('SELECT * FROM accounts WHERE id = ?', [id]);
    const first = result[0]?.values[0];
    return first ? rowToAccount(first) : null;
  }

  updateStatus(id: string, status: AccountRow['status']): void {
    this.db.raw.run('UPDATE accounts SET status = ? WHERE id = ?', [status, id]);
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

  list(): AccountRow[] {
    const result = this.db.raw.exec('SELECT * FROM accounts ORDER BY created_at ASC');
    const values = result[0]?.values ?? [];
    return values.map(rowToAccount);
  }
}
