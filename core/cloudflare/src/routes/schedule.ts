import { Hono } from 'hono';
import type { Context } from 'hono';
import { ScheduledPostsRepo } from '../repos/scheduledPosts';
import { VideosRepo } from '../repos/videos';
import { AccountsRepo } from '../repos/accounts';
import { bearerUserId } from '../lib/auth';
import type { ScheduledPostStatus, Visibility } from '../repos/types';
import type { Env } from '../env';

const CAPTION_MAX = 5000;
const SCHEDULE_LEAD_MS = 60_000;
const MAX_ACCOUNTS_PER_SCHEDULE = 50;
const STATUSES: ReadonlySet<string> = new Set(['pending', 'uploading', 'published', 'failed', 'dead']);
const VISIBILITIES: ReadonlySet<string> = new Set(['public', 'unlisted', 'private']);

interface ScheduleBody {
  video_id: string;
  caption: string;
  per_platform_caption?: Record<string, string>;
  scheduled_at: number;
  visibility?: Visibility;
  account_ids?: string[];
  /** Legacy single-account form — normalized into account_ids. */
  account_id?: string;
}

export const scheduleRoutes = new Hono<{ Bindings: Env }>();

scheduleRoutes.post('/schedule', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = (await c.req.json().catch(() => null)) as ScheduleBody | null;
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const accountIds = Array.isArray(body.account_ids)
    ? body.account_ids
    : body.account_id
      ? [body.account_id]
      : [];
  if (!body.video_id) return c.json({ error: 'video_id required' }, 400);
  if (!accountIds.length) return c.json({ error: 'account_ids required' }, 400);
  if (accountIds.length > MAX_ACCOUNTS_PER_SCHEDULE) {
    return c.json({ error: `too_many_accounts: maximum ${MAX_ACCOUNTS_PER_SCHEDULE}` }, 400);
  }
  if (typeof body.scheduled_at !== 'number') return c.json({ error: 'scheduled_at required (ms epoch)' }, 400);
  if (body.scheduled_at < Date.now() + SCHEDULE_LEAD_MS) {
    return c.json({ error: `scheduled_at must be at least ${SCHEDULE_LEAD_MS / 1000}s in the future` }, 400);
  }
  if (!body.caption || body.caption.length > CAPTION_MAX) {
    return c.json({ error: `caption required, max ${CAPTION_MAX} chars` }, 400);
  }
  if (body.visibility !== undefined && !VISIBILITIES.has(body.visibility)) {
    return c.json({ error: 'invalid_visibility' }, 400);
  }

  const video = await new VideosRepo(c.env.DB).findById(body.video_id);
  if (!video) return c.json({ error: 'video_not_found' }, 404);
  if (video.user_id !== userId) return c.json({ error: 'video_not_owned' }, 403);

  const accounts = new AccountsRepo(c.env.DB);
  const perPlatform = body.per_platform_caption ?? {};
  // Validate every account before inserting anything — otherwise a late
  // failure leaves partial rows and a client retry silently duplicates.
  for (const accId of accountIds) {
    const acc = await accounts.findById(accId);
    if (!acc) return c.json({ error: `account_not_found: ${accId}` }, 404);
    if (acc.user_id !== userId) return c.json({ error: `account_not_owned: ${accId}` }, 403);
    if (acc.status !== 'active') return c.json({ error: `account_not_active: ${accId}` }, 400);
    if ((perPlatform[accId] ?? body.caption).length > CAPTION_MAX) {
      return c.json({ error: `caption_too_long: ${accId}` }, 400);
    }
  }

  const posts = new ScheduledPostsRepo(c.env.DB);
  const created = [];
  for (const accId of accountIds) {
    created.push(
      await posts.insert({
        user_id: userId,
        video_id: body.video_id,
        account_id: accId,
        scheduled_at: body.scheduled_at,
        caption: perPlatform[accId] ?? body.caption,
        per_platform_caption: perPlatform[accId] ?? null,
        visibility: body.visibility ?? 'private',
      }),
    );
  }
  return c.json({ posts: created }, 201);
});

scheduleRoutes.get('/schedule', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const q = c.req.query();
  if (q.status && !STATUSES.has(q.status)) return c.json({ error: 'invalid_status' }, 400);
  const num = (v: string | undefined): number | undefined => {
    const n = Number(v);
    return v !== undefined && v !== '' && !Number.isNaN(n) ? n : undefined;
  };
  const posts = await new ScheduledPostsRepo(c.env.DB).list({
    userId,
    status: q.status as ScheduledPostStatus | undefined,
    accountId: q.account_id || undefined,
    from: num(q.from),
    to: num(q.to),
    q: q.q?.trim() || undefined,
    limit: Math.min(Math.max(Number(q.limit) || 500, 1), 500),
    offset: Math.max(Number(q.offset) || 0, 0),
  });
  return c.json({ posts });
});

async function ownedPost(c: Context<{ Bindings: Env }>, id: string) {
  const userId = await bearerUserId(c);
  if (!userId) return { error: c.json({ error: 'Unauthorized' }, 401) } as const;
  const post = await new ScheduledPostsRepo(c.env.DB).findById(id);
  if (!post) return { error: c.json({ error: 'not_found' }, 404) } as const;
  if (post.user_id !== userId) return { error: c.json({ error: 'access_denied' }, 403) } as const;
  return { post, posts: new ScheduledPostsRepo(c.env.DB) } as const;
}

scheduleRoutes.get('/schedule/:id', async (c) => {
  const r = await ownedPost(c, c.req.param('id'));
  if ('error' in r) return r.error;
  return c.json(r.post);
});

scheduleRoutes.patch('/schedule/:id', async (c) => {
  const r = await ownedPost(c, c.req.param('id'));
  if ('error' in r) return r.error;
  if (r.post.status !== 'pending') {
    return c.json({ error: `cannot_edit_post_in_status_${r.post.status}` }, 400);
  }
  const body = (await c.req.json().catch(() => null)) as
    | { caption?: string; scheduled_at?: number; visibility?: Visibility }
    | null;
  if (!body) return c.json({ error: 'invalid_body' }, 400);
  if (body.caption !== undefined && body.caption.length > CAPTION_MAX) {
    return c.json({ error: 'caption_too_long' }, 400);
  }
  if (body.visibility !== undefined && !VISIBILITIES.has(body.visibility)) {
    return c.json({ error: 'invalid_visibility' }, 400);
  }
  if (body.scheduled_at !== undefined && body.scheduled_at < Date.now() + SCHEDULE_LEAD_MS) {
    return c.json({ error: 'scheduled_at_too_soon' }, 400);
  }
  await r.posts.update(r.post.id, {
    caption: body.caption,
    scheduled_at: body.scheduled_at,
    visibility: body.visibility,
  });
  return c.json(await r.posts.findById(r.post.id));
});

/** Manual retry for failed/dead posts — powers the pipeline retry button. */
scheduleRoutes.post('/schedule/:id/retry', async (c) => {
  const r = await ownedPost(c, c.req.param('id'));
  if ('error' in r) return r.error;
  if (r.post.status !== 'failed' && r.post.status !== 'dead') {
    return c.json({ error: `cannot_retry_post_in_status_${r.post.status}` }, 400);
  }
  await r.posts.retry(r.post.id);
  return c.json(await r.posts.findById(r.post.id));
});

scheduleRoutes.delete('/schedule/:id', async (c) => {
  const r = await ownedPost(c, c.req.param('id'));
  if ('error' in r) return r.error;
  if (r.post.status !== 'pending') {
    return c.json({ error: `cannot_delete_post_in_status_${r.post.status}` }, 400);
  }
  await r.posts.delete(r.post.id);
  return c.json({ ok: true });
});

scheduleRoutes.get('/dashboard/counts', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const posts = await new ScheduledPostsRepo(c.env.DB).list({ userId });
  const now = Date.now();
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const byStatus = { pending: 0, uploading: 0, published: 0, failed: 0, dead: 0 };
  let publishedLast7d = 0;
  for (const p of posts) {
    byStatus[p.status]++;
    if (p.status === 'published' && p.updated_at >= since) publishedLast7d++;
  }
  return c.json({ by_status: byStatus, published_last_7d: publishedLast7d, generated_at: now });
});

scheduleRoutes.get('/history', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const q = c.req.query();
  let statusFilter = q.status as ScheduledPostStatus | undefined;
  if (q.status && !STATUSES.has(q.status)) statusFilter = undefined;

  // Platform filter resolves to a set of account ids first — keeps it one
  // indexed query on scheduled_posts instead of a JOIN per row.
  let accountId = q.account_id || undefined;
  let platformAccountIds: Set<string> | null = null;
  if (q.platform) {
    const rows = await new AccountsRepo(c.env.DB).list({
      userId,
      platform: q.platform as 'youtube' | 'tiktok' | 'instagram' | 'facebook',
    });
    platformAccountIds = new Set(rows.map((a) => a.id));
    if (!platformAccountIds.size) return c.json({ posts: [] });
  }
  const posts = await new ScheduledPostsRepo(c.env.DB).list({
    userId,
    status: statusFilter,
    accountId,
    from: q.date_from ? Date.parse(q.date_from) : undefined,
  });
  const filtered = platformAccountIds
    ? posts.filter((p) => platformAccountIds!.has(p.account_id))
    : posts;
  return c.json({ posts: filtered });
});

// Videos list — the schedule modal's video picker. Wire shape strips the
// storage path down to a basename; full keys never leave the server.
scheduleRoutes.get('/videos', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await new VideosRepo(c.env.DB).list(userId, 200);
  return c.json({
    videos: rows.map((v) => ({
      id: v.id,
      sha256: v.sha256,
      size_bytes: v.size_bytes,
      duration_sec: v.duration_sec,
      mime: v.mime,
      filename: v.file_path.split('/').pop() ?? v.file_path,
      has_thumbnail: !!v.thumbnail_path,
      created_at: v.created_at,
    })),
  });
});
