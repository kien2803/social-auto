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
  search?: string;
  contentCategory?: string;
  languageCode?: string;
  limit?: number;
  offset?: number;
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
    let sql = `SELECT * FROM accounts ${this.whereSql(filter)} ORDER BY created_at DESC`;
    const params = this.whereParams(filter);
    sql += ' LIMIT ? OFFSET ?';
    params.push(filter.limit ?? 200, filter.offset ?? 0);
    return (await this.db.prepare(sql).bind(...params).all<AccountRow>()).results;
  }

  async count(filter: ListFilter = {}): Promise<number> {
    const r = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM accounts ${this.whereSql(filter)}`)
      .bind(...this.whereParams(filter))
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  private whereSql(f: ListFilter): string {
    const parts = ['1=1'];
    if (f.userId) parts.push('user_id = ?');
    if (f.platform) parts.push('platform = ?');
    if (f.status) parts.push('status = ?');
    if (f.search) parts.push('(display_name LIKE ? OR external_id LIKE ?)');
    if (f.contentCategory) parts.push('content_category = ?');
    if (f.languageCode) parts.push('language_code = ?');
    return `WHERE ${parts.join(' AND ')}`;
  }

  private whereParams(f: ListFilter): unknown[] {
    const p: unknown[] = [];
    if (f.userId) p.push(f.userId);
    if (f.platform) p.push(f.platform);
    if (f.status) p.push(f.status);
    if (f.search) p.push(`%${f.search}%`, `%${f.search}%`);
    if (f.contentCategory) p.push(f.contentCategory);
    if (f.languageCode) p.push(f.languageCode);
    return p;
  }

  async updateMetadata(
    id: string,
    patch: Partial<Pick<AccountRow, 'content_category' | 'language_code' | 'purpose' | 'link'>>,
  ): Promise<void> {
    const cols = ['content_category', 'language_code', 'purpose', 'link'] as const;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const c of cols) {
      if (patch[c] !== undefined) { sets.push(`${c} = ?`); params.push(patch[c]); }
    }
    if (!sets.length) return;
    params.push(id);
    await this.db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
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
