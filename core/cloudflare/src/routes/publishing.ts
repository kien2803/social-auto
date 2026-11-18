import { Hono } from 'hono';
import { bearerUserId } from '../lib/auth';
import type { Env } from '../env';
import type { Platform, ScheduledPostStatus } from '../repos/types';

export const publishingRoutes = new Hono<{ Bindings: Env }>();

/**
 * Publishing Control Center feed — posts joined to their video + account,
 * grouped by video so the UI can render "one video → N platform jobs".
 *
 * Shape:
 *   jobs[].video            — id, filename, thumbnail flag, duration, size
 *   jobs[].counts           — per-status rollup for the header summary
 *   jobs[].last_activity_at — sort key: most recently touched group first
 *   jobs[].posts[]          — one row per (video × account) publish job
 */
interface JobRow {
  post_id: string;
  status: ScheduledPostStatus;
  error_class: string | null;
  last_error: string | null;
  retry_count: number;
  next_retry_at: number | null;
  scheduled_at: number;
  updated_at: number;
  external_post_id: string | null;
  video_id: string;
  file_path: string;
  thumbnail_path: string | null;
  duration_sec: number | null;
  size_bytes: number;
  account_id: string;
  platform: Platform;
  display_name: string;
  channel_handle: string;
  account_status: string;
}

publishingRoutes.get('/publishing/jobs', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT sp.id AS post_id, sp.status, sp.error_class, sp.last_error,
            sp.retry_count, sp.next_retry_at, sp.scheduled_at, sp.updated_at, sp.external_post_id,
            v.id AS video_id, v.file_path, v.thumbnail_path, v.duration_sec, v.size_bytes,
            a.id AS account_id, a.platform, a.display_name, a.channel_handle, a.status AS account_status
     FROM scheduled_posts sp
     JOIN videos v ON v.id = sp.video_id
     JOIN accounts a ON a.id = sp.account_id
     WHERE sp.user_id = ?
     ORDER BY sp.updated_at DESC`,
  )
    .bind(userId)
    .all<JobRow>();

  // Group by video, preserving updated_at DESC order — the group key lands
  // on the most recently touched post, so recency sorts itself.
  const jobs = new Map<string, {
    video: { id: string; filename: string; has_thumbnail: boolean; duration_sec: number | null; size_bytes: number };
    counts: Record<ScheduledPostStatus, number>;
    last_activity_at: number;
    posts: Array<Record<string, unknown>>;
  }>();
  for (const r of results ?? []) {
    let job = jobs.get(r.video_id);
    if (!job) {
      job = {
        video: {
          id: r.video_id,
          filename: r.file_path.split('/').pop() ?? r.file_path,
          has_thumbnail: r.thumbnail_path != null,
          duration_sec: r.duration_sec,
          size_bytes: r.size_bytes,
        },
        counts: { draft: 0, pending: 0, uploading: 0, published: 0, failed: 0, dead: 0 },
        last_activity_at: r.updated_at,
        posts: [],
      };
      jobs.set(r.video_id, job);
    }
    job.counts[r.status]++;
    if (r.updated_at > job.last_activity_at) job.last_activity_at = r.updated_at;
    job.posts.push({
      id: r.post_id,
      account_id: r.account_id,
      platform: r.platform,
      account_name: r.display_name,
      channel_handle: r.channel_handle,
      account_status: r.account_status,
      status: r.status,
      error_class: r.error_class,
      last_error: r.last_error,
      retry_count: r.retry_count,
      next_retry_at: r.next_retry_at,
      scheduled_at: r.scheduled_at,
      updated_at: r.updated_at,
      external_post_id: r.external_post_id,
    });
  }
  return c.json({ jobs: [...jobs.values()] });
});
