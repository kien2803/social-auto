import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { userAuthRoutes } from './routes/userAuth';
import { oauthRoutes } from './routes/oauth';
import { accountRoutes } from './routes/accounts';
import { scheduleRoutes } from './routes/schedule';
import { quotaRoutes } from './routes/quota';
import { ScheduledPostsRepo } from './repos/scheduledPosts';
import { MAX_PUBLISH_ATTEMPTS } from './lib/publishErrors';
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

/** Liveness + D1 reachability — 503 when the database ping fails so
 *  monitors catch a degraded worker, not just a dead one. */
async function healthCheck(c: Context<{ Bindings: Env }>) {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    // Worker heartbeat — cron writes last_cron_at each tick; if it goes
    // stale (>5 min) the publisher loop is dead even though fetch works.
    const hb = await c.env.DB.prepare(`SELECT value FROM meta WHERE key = 'last_cron_at'`).first<{ value: string }>();
    const lastCron = hb ? Number(hb.value) : 0;
    const lagSec = lastCron ? Math.round((Date.now() - lastCron) / 1000) : null;
    const workerStale = lagSec !== null && lagSec > 300;
    return c.json(
      { status: workerStale ? 'degraded' : 'ok', timestamp: Date.now(), runtime: 'cloudflare-workers', last_cron_at: lastCron || null, worker_lag_sec: lagSec },
      workerStale ? 503 : 200,
    );
  } catch (e) {
    return c.json({ status: 'degraded', error: e instanceof Error ? e.message : 'db_unreachable', timestamp: Date.now() }, 503);
  }
}

app.get('/health', healthCheck);

app.route('/', userAuthRoutes);
app.route('/api', userAuthRoutes);
app.route('/', oauthRoutes);
app.route('/api', oauthRoutes); // SPA calls /api/* same-origin
app.route('/api', accountRoutes);
app.route('/api', scheduleRoutes);
app.route('/api', quotaRoutes);
// /api/health aliases the root /health — the SPA probes the API path.
app.get('/api/health', healthCheck);

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
    // Heartbeat — health check reports worker staleness off this row.
    ctx.waitUntil(
      env.DB.prepare(`INSERT INTO meta (key, value, updated_at) VALUES ('last_cron_at', ?, ?)
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .bind(String(now), now)
        .run(),
    );
    // Reconcile posts stuck in 'uploading' (consumer crash / lost message)
    // older than 10 min back to pending before claiming fresh work.
    await new ScheduledPostsRepo(env.DB).unstickUploading(10 * 60 * 1000, now);
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
    const isDlq = batch.queue.includes('dlq');
    for (const msg of batch.messages) {
      const { postId } = msg.body;
      const posts = new ScheduledPostsRepo(env.DB);
      // Messages that exhausted retries land on the DLQ — mark the post
      // dead so it stops blocking and surfaces in the pipeline fault lane.
      if (isDlq) {
        await posts.markDead(postId, 'queue_retries_exhausted');
        msg.ack();
        continue;
      }
      const post = await posts.findClaimedWithJoin(postId);
      if (!post || post.status !== 'uploading') {
        msg.ack();
        continue;
      }
      // Dedupe: already has an external id → the platform got it; a second
      // attempt would double-post.
      if (post.external_post_id) {
        await posts.markPublished(postId, post.external_post_id);
        msg.ack();
        continue;
      }
      // Bounded retries — a poison post can't loop on the queue forever.
      if ((post.retry_count ?? 0) >= MAX_PUBLISH_ATTEMPTS) {
        await posts.markDead(postId, 'max_publish_attempts_exceeded');
        msg.ack();
        continue;
      }
      // TODO(P5): port publisher dispatch — call the platform publisher for
      // post.account.platform with decrypted tokens, then markPublished /
      // releaseToPending (classifyPublishError decides retry vs dead).
      // Blocked on R2 video storage; until then re-queue via queue retries.
      msg.retry();
    }
  },
};
