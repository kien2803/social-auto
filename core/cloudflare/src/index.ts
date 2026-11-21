import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { userAuthRoutes } from './routes/userAuth';
import { oauthRoutes } from './routes/oauth';
import { accountRoutes } from './routes/accounts';
import { scheduleRoutes } from './routes/schedule';
import { publishingRoutes } from './routes/publishing';
import { preflightRoutes } from './routes/preflight';
import { videoRoutes } from './routes/videos';
import { quotaRoutes } from './routes/quota';
import { commentsRoutes } from './routes/comments';
import { pollComments } from './lib/commentPoll';
import { ScheduledPostsRepo } from './repos/scheduledPosts';
import { AccountsRepo } from './repos/accounts';
import { QuotasRepo, UNITS_PER_UPLOAD } from './repos/quotas';
import { VideosRepo } from './repos/videos';
import { MAX_PUBLISH_ATTEMPTS, categorizePublishError, retryBackoffMs } from './lib/publishErrors';
import { usableAccessToken } from './lib/tokens';
import { signMediaUrl, verifyMediaSig } from './lib/signedMedia';
import { getPublisher } from './publish';
import { buildPublishMeta } from './publish/buildMeta';
import { PublishError, type PublishState } from './publish/types';
import type { ClaimedPost, Visibility } from './repos/types';
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
app.route('/api', publishingRoutes);
app.route('/api', preflightRoutes);
app.route('/api', videoRoutes);
app.route('/api', quotaRoutes);
app.route('/api', commentsRoutes);
// /api/health aliases the root /health — the SPA probes the API path.
app.get('/api/health', healthCheck);

// TikTok developer portal — domain ownership verification file.
app.get('/tiktok9M3PxVDaU23GxdXB3RV1DcGeZRfoFRqS.txt', (c) =>
  c.text('tiktok-developers-site-verification=9M3PxVDaU23GxdXB3RV1DcGeZRfoFRqS'),
);

/**
 * Signed public media — Instagram's crawler pulls video_url without
 * credentials, so the URL carries a short-lived HMAC grant instead of auth.
 * (path under /api so run_worker_first routes it here).
 */
app.get('/api/media/:id', async (c) => {
  const id = c.req.param('id');
  const expiry = Number(c.req.query('e'));
  const sig = c.req.query('s') ?? '';
  if (!(await verifyMediaSig(c.env, id, expiry, sig))) return c.json({ error: 'invalid_or_expired_signature' }, 403);
  const video = await new VideosRepo(c.env.DB).findById(id);
  if (!video) return c.json({ error: 'not_found' }, 404);
  const obj = await c.env.STORAGE.get(video.file_path);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': video.mime,
      'content-length': String(video.size_bytes),
      'cache-control': 'private, no-transform',
    },
  });
});

// SPA fallback — assets layer returns 404 for unknown paths before the
// worker runs, so serve index.html ourselves for non-API GETs.
app.get('*', (c) => {
  const p = c.req.path;
  if (p.startsWith('/api/') || p.startsWith('/auth/')) return c.notFound();
  return c.env.ASSETS.fetch(new URL('/', c.req.url).toString());
});

/**
 * One claimed post → one platform publish. Owns the whole failure matrix:
 *   permanent (validation/token/permission) → markFailed + error_class
 *   retryable (transient/rate-limit)        → releaseToPending + next_retry_at
 *   partial upload                          → platform_state resumes, no dup
 */
async function processPublish(post: ClaimedPost, env: Env): Promise<void> {
  const posts = new ScheduledPostsRepo(env.DB);
  const accounts = new AccountsRepo(env.DB);
  const quotas = new QuotasRepo(env.DB);
  const account = post.account;
  const platform = account.platform;

  if (account.status !== 'active') {
    await posts.markFailed(post.id, `account_${account.status}_reconnect_required`, 'token_expired');
    return;
  }

  // Daily platform quota — park until it refills rather than burning
  // attempts. Rate-limited backoff parks it until the window resets.
  if (!(await quotas.hasRemaining(platform))) {
    const day = new Date();
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
    await posts.releaseToPending(post.id, 'quota_exhausted', post.retry_count, midnight, 'rate_limited');
    return;
  }

  const publisher = getPublisher(platform);
  if (!publisher) {
    await posts.markFailed(post.id, `no_publisher_for_${platform}`, 'invalid_video');
    return;
  }

  // Access token — refresh as needed; a dead refresh token means the
  // grant is revoked → the account flips to 'expired' so the user sees a
  // reconnect signal instead of silent retry-burn.
  let accessToken: string;
  try {
    accessToken = await usableAccessToken(env, accounts, account);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cls = categorizePublishError(err);
    if (cls.category === 'token_expired') {
      await accounts.updateStatus(account.id, 'expired');
      await posts.markFailed(post.id, `account_expired: ${msg}`, 'token_expired');
    } else if (cls.retryable) {
      await posts.releaseToPending(post.id, `token_refresh_failed: ${msg}`, post.retry_count + 1, Date.now() + retryBackoffMs(cls.category, post.retry_count), cls.category);
    } else {
      await posts.markFailed(post.id, `token_refresh_failed: ${msg}`, cls.category);
    }
    return;
  }

  const meta = await buildPublishMeta({
    caption: post.caption,
    visibility: post.visibility,
    platformParams: post.platform_params,
    platform,
    externalId: account.external_id,
    videoId: post.video.id,
    signVideoUrl: (id) => signMediaUrl(env, id),
  });

  const video = {
    key: post.video.file_path,
    size_bytes: post.video.size_bytes,
    mime: post.video.mime,
    duration_sec: post.video.duration_sec,
  };
  const validation = publisher.validate(meta, video);
  if (!validation.ok) {
    await posts.markFailed(post.id, `validation_failed: ${validation.errors.join(', ')}`, 'invalid_video');
    return;
  }

  let state: PublishState | null = null;
  if (post.platform_state) {
    try { state = JSON.parse(post.platform_state) as PublishState; } catch { state = null; }
  }

  try {
    const result = await publisher.upload({
      env,
      access_token: accessToken,
      video,
      meta,
      state,
      saveState: (s) => posts.savePlatformState(post.id, s),
    });
    await posts.markPublished(post.id, result.external_id);
    await quotas.incrementUsage(platform, UNITS_PER_UPLOAD[platform], Date.now(), post.user_id);
  } catch (err) {
    if (err instanceof PublishError && err.state) {
      await posts.savePlatformState(post.id, err.state);
    }
    const msg = err instanceof Error ? err.message : String(err);
    const cls = categorizePublishError(err);
    if (cls.category === 'token_expired') {
      // A 401 despite a fresh token — the grant is dead.
      await accounts.updateStatus(account.id, 'expired');
      await posts.markFailed(post.id, `account_expired: ${msg}`, 'token_expired');
    } else if (cls.retryable) {
      await posts.releaseToPending(post.id, msg, post.retry_count + 1, Date.now() + retryBackoffMs(cls.category, post.retry_count), cls.category);
    } else {
      await posts.markFailed(post.id, msg, cls.category);
    }
  }
}

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
    // next_retry_at gates the claim — released retries sit 'pending' until
    // their backoff elapses.
    const { results } = await env.DB.prepare(
      `UPDATE scheduled_posts SET status = 'uploading', updated_at = ?
       WHERE status = 'pending' AND is_dead = 0
         AND scheduled_at <= ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       RETURNING id`,
    )
      .bind(now, now, now)
      .run<{ id: string }>();
    const jobs = (results ?? []).map((r) => ({ postId: r.id, attempt: 0 }));
    if (jobs.length) ctx.waitUntil(env.PUBLISH_QUEUE.sendBatch(jobs.map((body) => ({ body }))));
    ctx.waitUntil(pollComments(env));
  },

  /** Queue consumer: publish claimed posts. Bounded retries → DLQ → dead. */
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
      try {
        await processPublish(post, env);
        msg.ack();
      } catch (err) {
        // Unexpected crash mid-publish — the queue's own retry/DLQ covers
        // it; platform_state holds any resumable progress already saved.
        console.error('[queue] processPublish crashed', err);
        msg.retry();
      }
    }
  },
};
