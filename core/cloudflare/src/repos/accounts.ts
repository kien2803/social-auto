import type { AccountRow, AccountStatus, Platform } from './types';

export interface NewAccount {
  user_id: string;
  platform: Platform;
  external_id?: string;
  display_name: string;
  oauth_refresh_token: string;
  oauth_access_token?: string | null;
  token_expires_at?: number | null;
  status?: AccountStatus;
}

export interface ListFilter {
  userId?: string;
  platform?: Platform;
  status?: AccountStatus;
}

/** D1 rows come back keyed by column name — no positional mapping. */
export class AccountsRepo {
  constructor(private db: D1Database) {}

  async insert(input: NewAccount): Promise<AccountRow> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO accounts (id, user_id, platform, external_id, display_name,
          oauth_refresh_token, oauth_access_token, token_expires_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.user_id,
        input.platform,
        input.external_id ?? '',
        input.display_name,
        input.oauth_refresh_token,
        input.oauth_access_token ?? null,
        input.token_expires_at ?? null,
        input.status ?? 'active',
        now,
      )
      .run();
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<AccountRow | null> {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
  }

  async findByPlatformExternal(platform: Platform, externalId: string): Promise<AccountRow | null> {
    return this.db
      .prepare('SELECT * FROM accounts WHERE platform = ? AND external_id = ?')
      .bind(platform, externalId)
      .first<AccountRow>();
  }

  async listByPlatform(platform: Platform, userId?: string): Promise<AccountRow[]> {
    const q = userId
      ? this.db.prepare('SELECT * FROM accounts WHERE platform = ? AND user_id = ?').bind(platform, userId)
      : this.db.prepare('SELECT * FROM accounts WHERE platform = ?').bind(platform);
    return (await q.all<AccountRow>()).results;
  }

  async list(filter: ListFilter = {}): Promise<AccountRow[]> {
    let sql = 'SELECT * FROM accounts WHERE 1=1';
    const params: unknown[] = [];
    if (filter.userId) { sql += ' AND user_id = ?'; params.push(filter.userId); }
    if (filter.platform) { sql += ' AND platform = ?'; params.push(filter.platform); }
    if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
    sql += ' ORDER BY created_at DESC';
    return (await this.db.prepare(sql).bind(...params).all<AccountRow>()).results;
  }

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    await this.db.prepare('UPDATE accounts SET status = ? WHERE id = ?').bind(status, id).run();
  }

  async updateDisplayName(id: string, displayName: string): Promise<void> {
    await this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').bind(displayName, id).run();
  }

  async updateTokens(
    id: string,
    patch: { access_token?: string; refresh_token?: string; expires_at?: number | null },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.access_token !== undefined) { sets.push('oauth_access_token = ?'); params.push(patch.access_token); }
    if (patch.refresh_token !== undefined) { sets.push('oauth_refresh_token = ?'); params.push(patch.refresh_token); }
    if (patch.expires_at !== undefined) { sets.push('token_expires_at = ?'); params.push(patch.expires_at); }
    if (!sets.length) return;
    params.push(id);
    await this.db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  }

  async updateChannelSnapshot(id: string, snapshot: Partial<Record<keyof AccountRow, unknown>>): Promise<void> {
    const cols = ['channel_handle', 'avatar_url', 'subscribers', 'views', 'video_count',
      'like_count', 'avg_watch_seconds', 'drop_off_pct', 'last_sync_at'] as const;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const c of cols) {
      if (c in snapshot) { sets.push(`${c} = ?`); params.push(snapshot[c] as number | string | null); }
    }
    if (!sets.length) return;
    params.push(id);
    await this.db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  }

  async deleteById(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  }
}
