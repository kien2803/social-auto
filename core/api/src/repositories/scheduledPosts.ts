import type {
  AccountRow,
  ScheduledPostRow,
  ScheduledPostStatus,
  VideoRow,
  Visibility,
} from '@social-auto/shared';
import type { DB } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface NewScheduledPost {
  video_id: string;
  account_id: string;
  scheduled_at: number;
  caption: string;
  per_platform_caption?: string | null;
  visibility?: Visibility;
}

/**
 * Enriched claim result: the ScheduledPostRow plus the joined account and
 * video rows the worker needs to dispatch a publish. The worker previously
 * re-issued three findById calls per claim (post, account, video); with
 * this shape the only DB round-trips inside claimDuePosts are:
 *   1. one SELECT id (LIMIT N) for the candidate ids
 *   2. N UPDATE statements (one per candidate, racing-safe via the
 *      `WHERE status='pending'` predicate and rowsModified() check)
 *   3. one SELECT … JOIN accounts JOIN videos … WHERE sp.id IN (…) for the
 *      actually-claimed ids
 * — i.e. O(2N + 3) statements instead of O(3N + 1).
 */
export interface ClaimedScheduledPost extends ScheduledPostRow {
  account: AccountRow;
  video: VideoRow;
}

function rowToScheduledPost(row: unknown[]): ScheduledPostRow {
  return {
    id: row[0] as string,
    video_id: row[1] as string,
    account_id: row[2] as string,
    scheduled_at: row[3] as number,
    caption: row[4] as string,
    per_platform_caption: (row[5] as string | null) ?? null,
    visibility: row[6] as Visibility,
    status: row[7] as ScheduledPostStatus,
    external_post_id: (row[8] as string | null) ?? null,
    last_error: (row[9] as string | null) ?? null,
    retry_count: row[10] as number,
    next_retry_at: (row[11] as number | null) ?? null,
    is_dead: row[12] === 1 || row[12] === true,
    created_at: row[13] as number,
    updated_at: row[14] as number,
  };
}

/**
 * Slim variant of rowToScheduledPost for the projection used by listSlim.
 * The listSlim SELECT omits caption / per_platform_caption / last_error
 * and reorders the remaining 12 columns to put cheap metadata first, so the
 * slot indices here MUST stay in lock-step with the SELECT inside listSlim.
 * The full rowToScheduledPost above reads from the schema's natural order
 * and would return wrong values for status / retry_count / created_at
 * otherwise. Same bug pattern as rowToSlimAccount in accounts.ts.
 */
function rowToSlimScheduledPost(row: unknown[]): ScheduledPostRow {
  return {
    id: row[0] as string,
    video_id: row[1] as string,
    account_id: row[2] as string,
    scheduled_at: row[3] as number,
    visibility: row[4] as Visibility,
    status: row[5] as ScheduledPostStatus,
    external_post_id: (row[6] as string | null) ?? null,
    retry_count: row[7] as number,
    next_retry_at: (row[8] as number | null) ?? null,
    is_dead: row[9] === 1 || row[9] === true,
    created_at: row[10] as number,
    updated_at: row[11] as number,
    caption: '',
    per_platform_caption: null,
    last_error: null,
  };
}

/**
 * Decoder for the joined SELECT in claimDuePosts. Column order is:
 *   sp.*  (15 columns)         → row[0..14]
 *   a.*   (22 columns)         → row[15..36]   (account row)
 *   v.*   (8  columns)         → row[37..44]   (video row)
 * Mirrors the order produced by AccountsRepo.rowToAccount and
 * VideosRepo.rowToVideo; updates here MUST stay in lock-step with those.
 */
function rowToClaimedScheduledPost(row: unknown[]): ClaimedScheduledPost {
  const sp = rowToScheduledPost(row.slice(0, 15));
  const accountSlice = row.slice(15, 37);
  const videoSlice = row.slice(37);
  return {
    ...sp,
    account: {
      id: accountSlice[0] as string,
      platform: accountSlice[1] as AccountRow['platform'],
      external_id: (accountSlice[2] as string | null) ?? '',
      display_name: accountSlice[3] as string,
      oauth_refresh_token: accountSlice[4] as string,
      oauth_access_token: (accountSlice[5] as string | null) ?? null,
      token_expires_at: (accountSlice[6] as number | null) ?? null,
      status: accountSlice[7] as AccountRow['status'],
      created_at: accountSlice[8] as number,
      content_category: (accountSlice[9] as string | null) ?? '',
      language_code: (accountSlice[10] as string | null) ?? '',
      purpose: (accountSlice[11] as string | null) ?? '',
      link: (accountSlice[12] as string | null) ?? '',
      channel_handle: (accountSlice[13] as string | null) ?? '',
      avatar_url: (accountSlice[14] as string | null) ?? '',
      subscribers: (accountSlice[15] as number | null) ?? null,
      views: (accountSlice[16] as number | null) ?? null,
      video_count: (accountSlice[17] as number | null) ?? null,
      like_count: (accountSlice[18] as number | null) ?? null,
      avg_watch_seconds: (accountSlice[19] as number | null) ?? null,
      drop_off_pct: (accountSlice[20] as number | null) ?? null,
      last_sync_at: (accountSlice[21] as number | null) ?? null,
    },
    video: {
      id: videoSlice[0] as string,
      file_path: videoSlice[1] as string,
      sha256: videoSlice[2] as string,
      size_bytes: videoSlice[3] as number,
      duration_sec: (videoSlice[4] as number | null) ?? null,
      mime: videoSlice[5] as string,
      thumbnail_path: (videoSlice[6] as string | null) ?? null,
      created_at: videoSlice[7] as number,
    },
  };
}


export class ScheduledPostsRepo {
  constructor(private db: DB) {}

  /** Number of rows the last statement modified. */
  private rowsModified(): number {
    const raw = this.db.raw as unknown as { getRowsModified?: () => number };
    return raw.getRowsModified?.() ?? 0;
  }

  insert(input: NewScheduledPost): ScheduledPostRow {
    const row: ScheduledPostRow = {
      id: randomUUID(),
      video_id: input.video_id,
      account_id: input.account_id,
      scheduled_at: input.scheduled_at,
      caption: input.caption,
      per_platform_caption: input.per_platform_caption ?? null,
      visibility: input.visibility ?? 'private',
      status: 'pending',
      external_post_id: null,
      last_error: null,
      retry_count: 0,
      next_retry_at: null,
      is_dead: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.db.raw.run(
      `INSERT INTO scheduled_posts
       (id, video_id, account_id, scheduled_at, caption, per_platform_caption, visibility, status, external_post_id, last_error, retry_count, next_retry_at, is_dead, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.video_id,
        row.account_id,
        row.scheduled_at,
        row.caption,
        row.per_platform_caption,
        row.visibility,
        row.status,
        row.external_post_id,
        row.last_error,
        row.retry_count,
        row.next_retry_at,
        row.is_dead ? 1 : 0,
        row.created_at,
        row.updated_at,
      ],
    );
    return row;
  }

  findById(id: string): ScheduledPostRow | null {
    const result = this.db.raw.exec('SELECT * FROM scheduled_posts WHERE id = ?', [id]);
    const first = result[0]?.values[0];
    return first ? rowToScheduledPost(first) : null;
  }

  list(filters?: {
    status?: ScheduledPostStatus;
    accountId?: string;
    limit?: number;
  }): ScheduledPostRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.accountId) {
      where.push('account_id = ?');
      params.push(filters.accountId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters?.limit ?? 200;
    const result = this.db.raw.exec(
      `SELECT * FROM scheduled_posts ${whereSql} ORDER BY scheduled_at DESC LIMIT ?`,
      [...params, limit] as (string | number | null)[],
    );
    return (result[0]?.values ?? []).map(rowToScheduledPost);
  }

  /**
   * List variant that omits the (potentially large) caption and last_error
   * columns. The list endpoints (Dashboard, Schedule, History) need row
   * metadata, not the full text; full rows are fetched via findById on
   * demand. Cuts per-row wire size by ~5 KB when captions are at the 5000
   * char limit.
   */
  listSlim(filters?: {
    status?: ScheduledPostStatus;
    accountId?: string;
    limit?: number;
  }): ScheduledPostRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.accountId) {
      where.push('account_id = ?');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters?.limit ?? 200;
    const result = this.db.raw.exec(
      `SELECT id, video_id, account_id, scheduled_at, visibility, status,
              external_post_id, retry_count, next_retry_at, is_dead,
              created_at, updated_at, '' AS caption, NULL AS per_platform_caption,
              NULL AS last_error
       FROM scheduled_posts ${whereSql} ORDER BY scheduled_at DESC LIMIT ?`,
      [...params, limit] as (string | number | null)[],
    );
    return (result[0]?.values ?? []).map(rowToSlimScheduledPost);
  }


  /**
   * Atomically claim due posts. SQLite's per-row write lock means two workers
   * calling this concurrently each claim a disjoint set.
   *
   * Returns each claim joined with its account and video rows so the worker
   * does not have to re-issue three findById queries per claim before it can
   * dispatch to the publisher. See ClaimedScheduledPost for the shape.
   */
  claimDuePosts(now: number, limit = 5): ClaimedScheduledPost[] {
    const ids = this.db.raw.exec(
      `SELECT id FROM scheduled_posts
       WHERE status = 'pending'
         AND scheduled_at <= ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY scheduled_at ASC
       LIMIT ?`,
      [now, now, limit],
    );
    const rows = ids[0]?.values ?? [];
    const won: string[] = [];
    for (const idRow of rows) {
      const id = String(idRow[0]);
      this.db.raw.run(
        `UPDATE scheduled_posts
         SET status = 'uploading', updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [now, id],
      );
      if (this.rowsModified() === 0) continue;
      won.push(id);
    }
    if (won.length === 0) return [];
    // One JOINed SELECT for every winner — replaces the per-id findById that
    // used to fire after each UPDATE.
    const placeholders = won.map(() => '?').join(',');
    const enriched = this.db.raw.exec(
      `SELECT sp.*, a.*, v.* FROM scheduled_posts sp
       JOIN accounts a ON a.id = sp.account_id
       JOIN videos v ON v.id = sp.video_id
       WHERE sp.id IN (${placeholders})`,
      won,
    );
    return (enriched[0]?.values ?? []).map(rowToClaimedScheduledPost);
  }

  /**
   * Earliest scheduled_at among pending posts that are eligible to claim
   * right now (scheduled_at <= now and not in retry backoff). Used by the
   * worker to compute its next sleep interval — adaptive polling rather
   * than a fixed 30s wait. Returns null when no pending post is due or
   * within the next retry window.
   */
  nextDuePendingAt(now: number): number | null {
    const res = this.db.raw.exec(
      `SELECT MIN(scheduled_at) FROM scheduled_posts
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= ?)`,
      [now],
    );
    const v = res[0]?.values[0]?.[0];
    return typeof v === 'number' ? v : null;
  }

  markPublished(id: string, externalPostId: string): void {
    this.db.raw.run(
      `UPDATE scheduled_posts
       SET status = 'published', external_post_id = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
      [externalPostId, Date.now(), id],
    );
  }

  markFailed(id: string, error: string): void {
    this.db.raw.run(
      `UPDATE scheduled_posts
       SET status = 'failed', last_error = ?, updated_at = ?
       WHERE id = ?`,
      [error.slice(0, 1000), Date.now(), id],
    );
  }

  /**
   * Schedule a retry: back to 'pending', retry_count++, next_retry_at set.
   * If max retries exceeded, mark dead instead.
   */
  scheduleRetry(id: string, error: string, now: number, maxRetries = 5): void {
    const post = this.findById(id);
    if (!post) return;
    const newCount = post.retry_count + 1;
    if (newCount >= maxRetries) {
      this.db.raw.run(
        `UPDATE scheduled_posts
         SET status = 'dead', is_dead = 1, last_error = ?, retry_count = ?, updated_at = ?
         WHERE id = ?`,
        [error.slice(0, 1000), newCount, now, id],
      );
      return;
    }
    const backoffMs = Math.pow(2, newCount) * 60_000;
    this.db.raw.run(
      `UPDATE scheduled_posts
       SET status = 'pending', last_error = ?, retry_count = ?, next_retry_at = ?, updated_at = ?
       WHERE id = ?`,
      [error.slice(0, 1000), newCount, now + backoffMs, now, id],
    );
  }

  /**
   * On worker startup (and at the top of each poll cycle), recover rows left
   * 'uploading' from a crashed or hung previous run. Resetting to 'pending'
   * lets the next poll re-claim and retry them — the original Phase 3 design
   * set them to 'failed', which stranded them until a manual UI retry.
   */
  unstickUploading(olderThanMs: number, now: number): number {
    const cutoff = now - olderThanMs;
    this.db.raw.run(
      `UPDATE scheduled_posts
       SET status = 'pending', last_error = 'worker_crash_recovery',
           retry_count = retry_count + 1, updated_at = ?
       WHERE status = 'uploading' AND updated_at < ?`,
      [now, cutoff],
    );
    return this.rowsModified();
  }

  update(id: string, patch: { caption?: string; scheduled_at?: number; visibility?: Visibility }): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.caption !== undefined) {
      sets.push('caption = ?');
      params.push(patch.caption);
    }
    if (patch.scheduled_at !== undefined) {
      sets.push('scheduled_at = ?');
      params.push(patch.scheduled_at);
    }
    if (patch.visibility !== undefined) {
      sets.push('visibility = ?');
      params.push(patch.visibility);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    this.db.raw.run(
      `UPDATE scheduled_posts SET ${sets.join(', ')} WHERE id = ?`,
      params as (string | number | null)[],
    );
  }

  delete(id: string): void {
    this.db.raw.run('DELETE FROM scheduled_posts WHERE id = ?', [id]);
  }

  countByStatus(): Record<ScheduledPostStatus, number> {
    const result = this.db.raw.exec(
      `SELECT status, COUNT(*) AS n FROM scheduled_posts GROUP BY status`,
    );
    const out: Record<ScheduledPostStatus, number> = {
      pending: 0,
      uploading: 0,
      published: 0,
      failed: 0,
      dead: 0,
    };
    for (const r of result[0]?.values ?? []) {
      out[r[0] as ScheduledPostStatus] = r[1] as number;
    }
    return out;
  }

  lastPublishedAt(): number | null {
    const res = this.db.raw.exec(
      `SELECT MAX(updated_at) FROM scheduled_posts WHERE status = 'published'`,
    );
    const v = res[0]?.values[0]?.[0];
    return typeof v === 'number' ? v : null;
  }

  countPublishedSince(sinceMs: number, platform?: string): number {
    if (platform) {
      const res = this.db.raw.exec(
        `SELECT COUNT(*) FROM scheduled_posts sp
         JOIN accounts a ON a.id = sp.account_id
         WHERE sp.status = 'published' AND sp.updated_at >= ? AND a.platform = ?`,
        [sinceMs, platform],
      );
      return (res[0]?.values[0]?.[0] as number) ?? 0;
    }
    const res = this.db.raw.exec(
      `SELECT COUNT(*) FROM scheduled_posts WHERE status = 'published' AND updated_at >= ?`,
      [sinceMs],
    );
    return (res[0]?.values[0]?.[0] as number) ?? 0;
  }

  /**
   * Per-account stat block for /accounts/:id/stats. All-time counts by status
   * plus the timestamp of the most recent successful publish (null if none).
   * Uses updated_at for last_published_at since markPublished writes that at
   * external_post_id assignment.
   */
  countByStatusForAccount(accountId: string): {
    by_status: Record<ScheduledPostStatus, number>;
    total: number;
    last_published_at: number | null;
  } {
    const byStatus = this.db.raw.exec(
      `SELECT status, COUNT(*) AS n FROM scheduled_posts WHERE account_id = ? GROUP BY status`,
      [accountId],
    );
    const out: Record<ScheduledPostStatus, number> = {
      pending: 0,
      uploading: 0,
      published: 0,
      failed: 0,
      dead: 0,
    };
    let total = 0;
    for (const r of byStatus[0]?.values ?? []) {
      const n = r[1] as number;
      out[r[0] as ScheduledPostStatus] = n;
      total += n;
    }
    const lastPub = this.db.raw.exec(
      `SELECT MAX(updated_at) FROM scheduled_posts WHERE account_id = ? AND status = 'published'`,
      [accountId],
    );
    const last = lastPub[0]?.values[0]?.[0];
    return {
      by_status: out,
      total,
      last_published_at: typeof last === 'number' ? last : null,
    };
  }

  /**
   * Aggregate per-account stats for /analytics. When accountId is given,
   * returns a single-row breakdown for that account. When omitted, returns
   * every account joined with its counts (LEFT JOIN so accounts with zero
   * posts still appear with by_status={...0s}). last_published_at is null
   * for accounts that have never published.
   */
  analyticsByAccount(accountId?: string): Array<{
    account_id: string;
    platform: string;
    display_name: string;
    by_status: Record<ScheduledPostStatus, number>;
    total: number;
    last_published_at: number | null;
  }> {
    const zeroStatus = (): Record<ScheduledPostStatus, number> => ({
      pending: 0,
      uploading: 0,
      published: 0,
      failed: 0,
      dead: 0,
    });

    if (accountId) {
      const accRes = this.db.raw.exec(
        `SELECT id, platform, display_name FROM accounts WHERE id = ?`,
        [accountId],
      );
      const accRow = accRes[0]?.values[0];
      if (!accRow) return [];
      const stats = this.countByStatusForAccount(accountId);
      return [
        {
          account_id: accRow[0] as string,
          platform: accRow[1] as string,
          display_name: accRow[2] as string,
          ...stats,
        },
      ];
    }

    // All accounts + their counts in two queries (LEFT JOIN with empty group).
    const accRes = this.db.raw.exec(
      `SELECT id, platform, display_name FROM accounts ORDER BY created_at ASC`,
    );
    const counts = this.db.raw.exec(
      `SELECT account_id, status, COUNT(*) AS n
       FROM scheduled_posts GROUP BY account_id, status`,
    );
    const byAcc = new Map<
      string,
      { by_status: Record<ScheduledPostStatus, number>; total: number }
    >();
    for (const r of counts[0]?.values ?? []) {
      const aid = r[0] as string;
      const status = r[1] as ScheduledPostStatus;
      const n = r[2] as number;
      const slot =
        byAcc.get(aid) ??
        { by_status: zeroStatus(), total: 0 };
      slot.by_status[status] = n;
      slot.total += n;
      byAcc.set(aid, slot);
    }

    const lastPub = this.db.raw.exec(
      `SELECT account_id, MAX(updated_at) AS last_at
       FROM scheduled_posts WHERE status = 'published'
       GROUP BY account_id`,
    );
    const lastMap = new Map<string, number>();
    for (const r of lastPub[0]?.values ?? []) {
      lastMap.set(r[0] as string, r[1] as number);
    }

    return (accRes[0]?.values ?? []).map((row) => {
      const aid = row[0] as string;
      const slot = byAcc.get(aid) ?? { by_status: zeroStatus(), total: 0 };
      return {
        account_id: aid,
        platform: row[1] as string,
        display_name: row[2] as string,
        by_status: slot.by_status,
        total: slot.total,
        last_published_at: lastMap.get(aid) ?? null,
      };
    });
  }
}
