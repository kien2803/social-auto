import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Visibility } from '@social-auto/shared';
import type { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import type { VideosRepo } from '../repositories/videos.js';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export interface ScheduleDeps {
  posts: ScheduledPostsRepo;
  videos: VideosRepo;
  accounts: AccountsRepo;
  authMiddleware: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

interface ScheduleBody {
  video_id: string;
  account_id: string;
  scheduled_at: number;
  caption: string;
  visibility?: Visibility;
}

const CAPTION_MAX = 5000;
const SCHEDULE_LEAD_MS = 60_000;
const MAX_ACCOUNTS_PER_SCHEDULE = 50;
const VISIBILITIES: ReadonlySet<string> = new Set(['public', 'unlisted', 'private']);

interface MultiScheduleBody {
  video_id: string;
  /** One caption shared across all selected accounts. */
  caption: string;
  /** Per-platform caption overrides keyed by account_id. */
  per_platform_caption?: Record<string, string>;
  scheduled_at: number;
  visibility?: Visibility;
  account_ids: string[];
}

function validateBase(body: ScheduleBody | MultiScheduleBody): string | null {
  if (!body.video_id) return 'video_id required';
  if (Array.isArray((body as MultiScheduleBody).account_ids)) {
    if ((body as MultiScheduleBody).account_ids.length === 0) return 'account_ids required';
  } else if (!(body as ScheduleBody).account_id) {
    return 'account_id required';
  }
  if (typeof body.scheduled_at !== 'number') return 'scheduled_at required (ms epoch)';
  if (body.scheduled_at < Date.now() + SCHEDULE_LEAD_MS) {
    return `scheduled_at must be at least ${SCHEDULE_LEAD_MS / 1000}s in the future`;
  }
  if (!body.caption || body.caption.length > CAPTION_MAX) {
    return `caption required, max ${CAPTION_MAX} chars`;
  }
  if (body.visibility !== undefined && !VISIBILITIES.has(body.visibility)) {
    return 'invalid_visibility';
  }
  return null;
}

export function registerScheduleRoutes(app: FastifyInstance, deps: ScheduleDeps): void {
  app.post('/schedule', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const body = req.body as MultiScheduleBody | ScheduleBody;
    const err = validateBase(body);
    if (err) return reply.code(400).send({ error: err });

    const video = deps.videos.findById(body.video_id);
    if (!video) return reply.code(404).send({ error: 'video_not_found' });

    const userId = (req as AuthenticatedRequest).userId!;

    // Check video ownership
    if (video.user_id !== userId) {
      return reply.code(403).send({ error: 'video_not_owned' });
    }

    // Clients may send either account_ids[] (multi) or account_id
    // (single). validateBase accepts both — normalize here so the
    // single form doesn't crash on undefined.length.
    const accountIds =
      'account_ids' in body && Array.isArray(body.account_ids)
        ? body.account_ids
        : 'account_id' in body && body.account_id
          ? [body.account_id]
          : [];
    if (accountIds.length > MAX_ACCOUNTS_PER_SCHEDULE) {
      return reply.code(400).send({ error: `too_many_accounts: maximum ${MAX_ACCOUNTS_PER_SCHEDULE} accounts per schedule` });
    }

    const perPlatform = ('per_platform_caption' in body ? body.per_platform_caption : undefined) ?? {};
    // Validate EVERY account before inserting anything — the previous
    // validate-and-insert-in-one-loop left rows behind when a later
    // account failed, so a client retry silently duplicated posts.
    for (const accId of accountIds) {
      const acc = deps.accounts.findById(accId);
      if (!acc) return reply.code(404).send({ error: `account_not_found: ${accId}` });
      if (acc.user_id !== userId) {
        return reply.code(403).send({ error: `account_not_owned: ${accId}` });
      }
      if (acc.status !== 'active') {
        return reply.code(400).send({ error: `account_not_active: ${accId}` });
      }
      const caption = perPlatform[accId] ?? body.caption;
      if (caption.length > CAPTION_MAX) {
        return reply.code(400).send({ error: `caption_too_long: ${accId}` });
      }
    }
    const created = [];
    for (const accId of accountIds) {
      const caption = perPlatform[accId] ?? body.caption;
      const row = deps.posts.insert({
        user_id: userId,
        video_id: body.video_id,
        account_id: accId,
        scheduled_at: body.scheduled_at,
        caption,
        per_platform_caption: perPlatform[accId] ?? null,
        visibility: body.visibility ?? 'private',
      });
      created.push(row);
    }
    return reply.code(201).send({ posts: created });
  });

  app.get('/schedule', { preHandler: deps.authMiddleware }, async (req) => {
    const q = req.query as { status?: string; account_id?: string; limit?: string; offset?: string };
    const userId = (req as AuthenticatedRequest).userId;
    const limit = Math.min(Math.max(parseInt(q.limit ?? '200', 10) || 200, 1), 500);
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
    return {
      posts: deps.posts.listSlim({
        status: q.status as never,
        accountId: q.account_id,
        userId,
        limit,
        offset,
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/schedule/:id', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const post = deps.posts.findById(req.params.id);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    if (post.user_id !== userId) {
      return reply.code(403).send({ error: 'access_denied' });
    }
    return post;
  });

  app.patch<{ Params: { id: string } }>('/schedule/:id', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const post = deps.posts.findById(req.params.id);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    if (post.user_id !== userId) {
      return reply.code(403).send({ error: 'access_denied' });
    }
    if (post.status !== 'pending') {
      return reply.code(400).send({ error: `cannot_edit_post_in_status_${post.status}` });
    }
    const body = req.body as Partial<ScheduleBody>;
    if (body.caption !== undefined && body.caption.length > CAPTION_MAX) {
      return reply.code(400).send({ error: 'caption_too_long' });
    }
    if (body.visibility !== undefined && !VISIBILITIES.has(body.visibility)) {
      return reply.code(400).send({ error: 'invalid_visibility' });
    }
    if (body.scheduled_at !== undefined && body.scheduled_at < Date.now() + SCHEDULE_LEAD_MS) {
      return reply.code(400).send({ error: 'scheduled_at_too_soon' });
    }
    deps.posts.update(req.params.id, {
      caption: body.caption,
      scheduled_at: body.scheduled_at,
      visibility: body.visibility,
    });
    return deps.posts.findById(req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/schedule/:id', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const post = deps.posts.findById(req.params.id);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    if (post.user_id !== userId) {
      return reply.code(403).send({ error: 'access_denied' });
    }
    if (post.status !== 'pending') {
      return reply.code(400).send({ error: `cannot_delete_post_in_status_${post.status}` });
    }
    deps.posts.delete(req.params.id);
    return { ok: true };
  });

  // Lightweight dashboard rollup for the home page. Returns the post count
  // per status plus a 7-day publish volume so the UI can render the header
  // counters in a single fetch. Kept on /schedule.ts (rather than /health.ts)
  // because the underlying data is posts-only; /health mixes in account
  // rollup which would otherwise need a second DB pass here.
  app.get('/dashboard/counts', { preHandler: deps.authMiddleware }, async (req) => {
    const userId = (req as AuthenticatedRequest).userId;
    const now = Date.now();
    const since = now - 7 * 24 * 60 * 60 * 1000;
    const posts = deps.posts.list({ userId });
    const byStatus = { pending: 0, uploading: 0, published: 0, failed: 0, dead: 0 };
    let publishedLast7d = 0;
    for (const p of posts) {
      byStatus[p.status]++;
      if (p.status === 'published' && p.updated_at >= since) {
        publishedLast7d++;
      }
    }
    return {
      by_status: byStatus,
      published_last_7d: publishedLast7d,
      generated_at: now,
    };
  });




  app.get('/history', { preHandler: deps.authMiddleware }, async (req) => {
    const q = req.query as {
      platform?: string;
      status?: string;
      account_id?: string;
      date_from?: string;
    };
    const userId = (req as AuthenticatedRequest).userId;
    let posts = deps.posts.list({ status: q.status as never, userId });
    if (q.platform) {
      // Use SQL JOIN for platform filtering instead of JavaScript filtering
      // to avoid N+1 query and loading all accounts into memory
      const accountIdsByPlatform = deps.accounts
        .listSlim({ platform: q.platform as never, userId })
        .map((a) => a.id);
      posts = posts.filter((p) => accountIdsByPlatform.includes(p.account_id));
    }
    if (q.account_id) {
      posts = posts.filter((p) => p.account_id === q.account_id);
    }
    if (q.date_from) {
      const cutoff = Date.parse(q.date_from);
      if (!Number.isNaN(cutoff)) {
        posts = posts.filter((p) => p.scheduled_at >= cutoff);
      }
    }
    return { posts };
  });
  // Health check is mounted by buildApp.
}
