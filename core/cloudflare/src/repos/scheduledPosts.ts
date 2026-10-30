import type {
  ClaimedPost, ScheduledPostRow, ScheduledPostStatus, Visibility,
} from './types';

export interface NewScheduledPost {
  user_id: string;
  video_id: string;
  account_id: string;
  scheduled_at: number;
  caption: string;
  per_platform_caption?: string | null;
  visibility?: Visibility;
}

const STATUSES: readonly ScheduledPostStatus[] = ['pending', 'uploading', 'published', 'failed', 'dead'];

export class ScheduledPostsRepo {
  constructor(private db: D1Database) {}

  async insert(input: NewScheduledPost): Promise<ScheduledPostRow> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO scheduled_posts
         (id, user_id, video_id, account_id, scheduled_at, caption, per_platform_caption, visibility, status, external_post_id, last_error, retry_count, next_retry_at, is_dead, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, 0, ?, ?)`,
      )
      .bind(id, input.user_id, input.video_id, input.account_id, input.scheduled_at,
        input.caption, input.per_platform_caption ?? null, input.visibility ?? 'private', now, now)
      .run();
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<ScheduledPostRow | null> {
    return this.db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').bind(id).first<ScheduledPostRow>();
  }

  /** Post + joined account + video — what the queue consumer needs to publish.
   *  Joined columns alias-prefixed (a_/v_) because duplicate column names
   *  (id, user_id, created_at…) would collide in the flat row object. */
  async findClaimedWithJoin(id: string): Promise<ClaimedPost | null> {
    const row = await this.db
      .prepare(
        `SELECT sp.*,
           a.id AS a_id, a.user_id AS a_user_id, a.platform AS a_platform,
           a.external_id AS a_external_id, a.display_name AS a_display_name,
           a.oauth_refresh_token AS a_oauth_refresh_token, a.oauth_access_token AS a_oauth_access_token,
           a.token_expires_at AS a_token_expires_at, a.status AS a_status, a.created_at AS a_created_at,
           a.content_category AS a_content_category, a.language_code AS a_language_code,
           a.purpose AS a_purpose, a.link AS a_link, a.channel_handle AS a_channel_handle,
           a.avatar_url AS a_avatar_url, a.subscribers AS a_subscribers, a.views AS a_views,
           a.video_count AS a_video_count, a.like_count AS a_like_count,
           a.avg_watch_seconds AS a_avg_watch_seconds, a.drop_off_pct AS a_drop_off_pct,
           a.last_sync_at AS a_last_sync_at,
           v.id AS v_id, v.user_id AS v_user_id, v.file_path AS v_file_path, v.sha256 AS v_sha256,
           v.size_bytes AS v_size_bytes, v.duration_sec AS v_duration_sec, v.mime AS v_mime,
           v.thumbnail_path AS v_thumbnail_path, v.created_at AS v_created_at
         FROM scheduled_posts sp
         JOIN accounts a ON a.id = sp.account_id
         JOIN videos v ON v.id = sp.video_id
         WHERE sp.id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const account = Object.fromEntries(
      Object.entries(row)
        .filter(([k]) => k.startsWith('a_'))
        .map(([k, v]) => [k.slice(2), v]),
    );
    const video = Object.fromEntries(
      Object.entries(row)
        .filter(([k]) => k.startsWith('v_'))
        .map(([k, v]) => [k.slice(2), v]),
    );
    const post = Object.fromEntries(
      Object.entries(row).filter(([k]) => !k.startsWith('a_') && !k.startsWith('v_')),
    );
    return { ...post, account, video } as unknown as ClaimedPost;
  }

  async list(filters?: { status?: ScheduledPostStatus; accountId?: string; userId?: string; from?: number; to?: number; limit?: number; offset?: number }): Promise<ScheduledPostRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) { where.push('status = ?'); params.push(filters.status); }
    if (filters?.accountId) { where.push('account_id = ?'); params.push(filters.accountId); }
    if (filters?.userId) { where.push('user_id = ?'); params.push(filters.userId); }
    if (filters?.from !== undefined) { where.push('scheduled_at >= ?'); params.push(filters.from); }
    if (filters?.to !== undefined) { where.push('scheduled_at <= ?'); params.push(filters.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return (await this.db
      .prepare(`SELECT * FROM scheduled_posts ${whereSql} ORDER BY scheduled_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, filters?.limit ?? 200, filters?.offset ?? 0)
      .all<ScheduledPostRow>()).results;
  }

  async markPublished(id: string, externalPostId: string): Promise<void> {
    await this.db
      .prepare(`UPDATE scheduled_posts SET status = 'published', external_post_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
      .bind(externalPostId, Date.now(), id)
      .run();
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .prepare(`UPDATE scheduled_posts SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(error.slice(0, 1000), Date.now(), id)
      .run();
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.db
      .prepare(`UPDATE scheduled_posts SET status = 'dead', is_dead = 1, last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(error.slice(0, 1000), Date.now(), id)
      .run();
  }

  /** Back to pending when a queue message is retried (queue handles backoff). */
  async releaseToPending(id: string, error: string, retryCount: number): Promise<void> {
    await this.db
      .prepare(`UPDATE scheduled_posts SET status = 'pending', last_error = ?, retry_count = ?, updated_at = ? WHERE id = ?`)
      .bind(error.slice(0, 1000), retryCount, Date.now(), id)
      .run();
  }

  async unstickUploading(olderThanMs: number, now: number): Promise<void> {
    await this.db
      .prepare(`UPDATE scheduled_posts SET status = 'pending', last_error = 'worker_crash_recovery', retry_count = retry_count + 1, updated_at = ? WHERE status = 'uploading' AND updated_at < ?`)
      .bind(now, now - olderThanMs)
      .run();
  }

  async update(id: string, patch: { caption?: string; scheduled_at?: number; visibility?: Visibility }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.caption !== undefined) { sets.push('caption = ?'); params.push(patch.caption); }
    if (patch.scheduled_at !== undefined) { sets.push('scheduled_at = ?'); params.push(patch.scheduled_at); }
    if (patch.visibility !== undefined) { sets.push('visibility = ?'); params.push(patch.visibility); }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    params.push(Date.now(), id);
    await this.db.prepare(`UPDATE scheduled_posts SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM scheduled_posts WHERE id = ?').bind(id).run();
  }

  async countByVideoId(videoId: string): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM scheduled_posts WHERE video_id = ?').bind(videoId).first<{ n: number }>();
    return r?.n ?? 0;
  }

  async countByStatus(userId?: string): Promise<Record<ScheduledPostStatus, number>> {
    const q = userId
      ? this.db.prepare('SELECT status, COUNT(*) AS n FROM scheduled_posts WHERE user_id = ? GROUP BY status').bind(userId)
      : this.db.prepare('SELECT status, COUNT(*) AS n FROM scheduled_posts GROUP BY status');
    const out = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ScheduledPostStatus, number>;
    for (const r of (await q.all<{ status: ScheduledPostStatus; n: number }>()).results) out[r.status] = r.n;
    return out;
  }

  async lastPublishedAt(userId?: string, accountId?: string): Promise<number | null> {
    let sql = `SELECT MAX(updated_at) AS m FROM scheduled_posts WHERE status = 'published'`;
    const params: unknown[] = [];
    if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
    if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
    const r = await this.db.prepare(sql).bind(...params).first<{ m: number | null }>();
    return r?.m ?? null;
  }

  async countByStatusForAccount(accountId: string): Promise<Record<ScheduledPostStatus, number>> {
    const out = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ScheduledPostStatus, number>;
    const rows = (
      await this.db
        .prepare('SELECT status, COUNT(*) AS n FROM scheduled_posts WHERE account_id = ? GROUP BY status')
        .bind(accountId)
        .all<{ status: ScheduledPostStatus; n: number }>()
    ).results;
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /** Per-account status rollups for the Analytics page. Joins accounts so
   *  platform + display_name ride along; scoped to the owning user. */
  async analyticsByAccount(accountId: string | undefined, userId: string) {
    let sql = `SELECT a.id AS account_id, a.platform, a.display_name,
         COUNT(sp.id) AS total,
         SUM(CASE WHEN sp.status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN sp.status = 'uploading' THEN 1 ELSE 0 END) AS uploading,
         SUM(CASE WHEN sp.status = 'published' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN sp.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN sp.status = 'dead' THEN 1 ELSE 0 END) AS dead,
         MAX(CASE WHEN sp.status = 'published' THEN sp.updated_at END) AS last_published_at
       FROM accounts a
       LEFT JOIN scheduled_posts sp ON sp.account_id = a.id
       WHERE a.user_id = ?`;
    const params: unknown[] = [userId];
    if (accountId) { sql += ' AND a.id = ?'; params.push(accountId); }
    sql += ' GROUP BY a.id ORDER BY a.created_at DESC';
    const { results } = await this.db.prepare(sql).bind(...params).all<{
      account_id: string;
      platform: string;
      display_name: string;
      total: number;
      pending: number | null;
      uploading: number | null;
      published: number | null;
      failed: number | null;
      dead: number | null;
      last_published_at: number | null;
    }>();
    return results.map((r) => ({
      account_id: r.account_id,
      platform: r.platform,
      display_name: r.display_name,
      by_status: {
        pending: r.pending ?? 0,
        uploading: r.uploading ?? 0,
        published: r.published ?? 0,
        failed: r.failed ?? 0,
        dead: r.dead ?? 0,
      },
      total: r.total,
      last_published_at: r.last_published_at,
    }));
  }
}
