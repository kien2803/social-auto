import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { userAuthRoutes } from './routes/userAuth';
import { oauthRoutes } from './routes/oauth';
import { accountRoutes } from './routes/accounts';
import { scheduleRoutes } from './routes/schedule';
import { quotaRoutes } from './routes/quota';
import { ScheduledPostsRepo } from './repos/scheduledPosts';
import type { Env, PublishJob } from './env';

const app = new Hono<{ Bindings: Env }>();

// Only the SPA's own origin may make credentialed calls. Reflecting the
// request origin (the previous behaviour) meant any website could hit the
// API with the user's cookies attached.
app.use(
  '*',
  cors({
    origin: (origin, c) => (origin === c.env.WEB_ORIGIN ? origin : undefined),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: Date.now(), runtime: 'cloudflare-workers' }),
);

app.route('/', userAuthRoutes);
app.route('/api', userAuthRoutes);
app.route('/', oauthRoutes);
app.route('/api', oauthRoutes); // SPA calls /api/* same-origin
app.route('/api', accountRoutes);
app.route('/api', scheduleRoutes);
app.route('/api', quotaRoutes);

// SPA fallback — assets layer returns 404 for unknown paths before the
// worker runs, so serve index.html ourselves for non-API GETs.
app.get('*', (c) => {
  const p = c.req.path;
  if (p.startsWith('/api/') || p.startsWith('/auth/')) return c.notFound();
  return c.env.ASSETS.fetch(new URL('/', c.req.url).toString());
});

export default {
  fetch: app.fetch,

  /** Cron: claim due posts → enqueue. Replaces the 30s in-process poll loop. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const now = Date.now();
    const { results } = await env.DB.prepare(
      `UPDATE scheduled_posts SET status = 'uploading', updated_at = ?
       WHERE status = 'pending' AND is_dead = 0
         AND (scheduled_at <= ? OR (next_retry_at IS NOT NULL AND next_retry_at <= ?))
       RETURNING id`,
    )
      .bind(now, now, now)
      .run<{ id: string }>();
    const jobs = (results ?? []).map((r) => ({ postId: r.id, attempt: 0 }));
    if (jobs.length) ctx.waitUntil(env.PUBLISH_QUEUE.sendBatch(jobs.map((body) => ({ body }))));
  },

  /** Queue consumer: publish claimed posts. Retries → queue retry; DLQ → dead. */
  async queue(batch: MessageBatch<PublishJob>, env: Env) {
    for (const msg of batch.messages) {
      const { postId } = msg.body;
      const posts = new ScheduledPostsRepo(env.DB);
      const post = await posts.findClaimedWithJoin(postId);
      if (!post || post.status !== 'uploading') {
        msg.ack();
        continue;
      }
      // TODO(P5): port publisher dispatch — call the platform publisher for
      // post.account.platform with decrypted tokens, then markPublished /
      // releaseToPending. Queue retries handle backoff; DLQ → markDead.
      msg.retry();
    }
  },
};
