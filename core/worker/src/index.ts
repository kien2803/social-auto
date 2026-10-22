/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Worker entry. Polls scheduled_posts, claims due posts, dispatches to the right
 * publisher by account.platform.
 *
 * Token lifecycle:
 *   - Decrypt access_token from DB. If near expiry, refresh via refresh_token
 *     and persist the new pair back to DB before uploading.
 *   - On upload failure, classify the error:
 *       * transient (network / 5xx / quota / rate-limit) → scheduleRetry
 *       * authorization (invalid_grant / revoked) → mark account 'expired'
 *         and the post 'dead' so the user sees a clear "reconnect" signal.
 */
import { setTimeout as wait } from 'node:timers/promises';
import { openDB, type DB } from './db.js';
import { captureException } from './sentry.js';
import { AccountsRepo } from './repositories/accounts.js';
import { ScheduledPostsRepo, type ClaimedScheduledPost } from './repositories/scheduledPosts.js';
import { VideosRepo } from './repositories/videos.js';
import { QuotasRepo } from './repositories/quotas.js';
import { getPublisher } from './publishers/index.js';
import { createGoogleClient } from './publishers/googleClient.js';
import { decrypt, encrypt } from '@social-auto/shared/utils/crypto.js';
import { env } from './env.js';
import { initSentry } from './sentry.js';
import type { GoogleOAuthClient } from './publishers/googleClientTypes.js';

const POLL_INTERVAL_MS = 30_000;
const CLAIM_BATCH = 5;
/**
 * Max uploads in flight at once. Most platforms rate-limit per-account, not
 * per-process, so 3 lets a single YouTube + single TikTok + single IG run
 * together without piling onto one platform's limiter.
 */
const UPLOAD_CONCURRENCY = 3;
const UNSTICK_AFTER_MS = 30 * 60_000;
/** Refresh access_token this many ms before it actually expires. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

interface PollDeps {
  db: DB;
  accounts: AccountsRepo;
  posts: ScheduledPostsRepo;
  videos: VideosRepo;
  quotas: QuotasRepo;
  google: GoogleOAuthClient;
}

export async function runWorker(): Promise<void> {
  // Initialize Sentry error tracking
  initSentry();

  const db = await openDB(env.databaseUrl);
  const accounts = new AccountsRepo(db);
  const posts = new ScheduledPostsRepo(db);
  const videos = new VideosRepo(db);
  const quotas = new QuotasRepo(db);

  const google = createGoogleClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.googleRedirectUri,
  });

  // Crash-recovery: any posts left in 'uploading' from a previous
  // process are orphans — the in-flight handler died before it could
  // mark them published or failed. Reset them to 'pending' so the next
  // poll picks them up. Runs at every poll too (INFRA-004), but the
  // startup sweep covers crashes from a process that never got to its
  // first poll.
  const unstuck = posts.unstickUploading(UNSTICK_AFTER_MS, Date.now());
  if (unstuck > 0) {
    console.log(`[worker] unstuck ${unstuck} posts from previous crash`);
  }

  // Graceful shutdown: when PM2 / Docker / Ctrl+C sends SIGTERM or
  // SIGINT, stop accepting new poll cycles, wait for any in-flight
  // uploads to settle, flush the DB, and close. Without this, an upload
  // mid-flight is left as 'uploading' on disk and the next worker
  // restart has to recover via unstickUploading — which is now also
  // invoked every poll, but skipping it here still races with the API.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      console.warn(`[worker] received ${signal} again — forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[worker] received ${signal} — draining in-flight work`);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.log('[worker] starting poll loop');
  for (;;) {
    if (shuttingDown) {
      // Best-effort flush before exiting. The API process will see this
      // process is gone and stop relying on its handle; the next worker
      // boot reopens the file and picks up where we left off.
      try {
        db.flush();
        db.close();
      } catch (err) {
        console.error('[worker] shutdown flush failed', err);
      }
      console.log('[worker] stopped cleanly');
      return;
    }
    let nextDue: number;
    try {
      nextDue = await pollOnce({ db, accounts, posts, videos, quotas, google });
    } catch (err) {
      console.error('[worker] poll error', err);
      nextDue = Date.now() + POLL_INTERVAL_MS;
    }
    // OPT-5: adaptive sleep. After a poll that claimed work, return
    // immediately — uploads may have produced new pending rows (retries)
    // that we want to pick up on the next pass. After an idle poll, sleep
    // until the next pending post is due, capped at POLL_INTERVAL_MS as a
    // sanity floor so an empty queue still wakes occasionally.
    const sleepMs = Math.max(0, Math.min(nextDue - Date.now(), POLL_INTERVAL_MS));
    await wait(Math.max(1000, sleepMs));
  }
}

export async function pollOnce(deps: PollDeps): Promise<number> {
  // Pick up writes the API process made since we last looked. Without this,
  // sql.js's in-memory cache (per-process) would never see the API's inserts.
  // This MUST run before any write below: persist() exports our whole
  // in-memory snapshot, so writing from a stale snapshot would clobber
  // whatever the API persisted in the meantime.
  const reloaded = deps.db.refreshIfChanged();
  if (reloaded) console.log('[worker] DB reloaded from disk (mtime changed)');
  // INFRA-004: every poll must scan for posts the previous tick left
  // 'uploading' (worker crashed mid-upload, or process was killed).
  // Without this, a permanently stuck upload is only recovered on the
  // next worker restart — which is fine for clean PM2 restarts, but a
  // out-of-band SIGKILL or OOM leaves the row orphaned indefinitely.
  const unstuck = deps.posts.unstickUploading(UNSTICK_AFTER_MS, Date.now());
  if (unstuck > 0) {
    console.log(`[worker] unstuck ${unstuck} post(s) from previous poll`);
  }
  const claimed = deps.posts.claimDuePosts(Date.now(), CLAIM_BATCH);
  if (claimed.length > 0) console.log(`[worker] claimed ${claimed.length} post(s)`);
  if (claimed.length > 0) {
    for (const post of claimed) console.log(`[worker] processing ${post.id}`);
    // OPT-1: pass the joined claim directly — processOne no longer needs
    // to re-issue findById for post, account, or video. The claim shape
    // already carries every column those calls would have fetched.
    await runWithConcurrency(
      claimed,
      UPLOAD_CONCURRENCY,
      (claim) => processOne(claim, deps),
    );
    for (const post of claimed) console.log(`[worker] processed ${post.id}`);
  }
  // Persist all in-memory writes from this poll at once. Avoiding per-write
  // persist prevents racing the API process over the SQLite file.
  deps.db.flush();
  // OPT-5: return the next due timestamp so runWorker can adaptively sleep.
  // Returning it here (rather than reading the DB twice) keeps the loop tight
  // and lets the caller decide the sleep floor.
  return deps.posts.nextDuePendingAt(Date.now()) ?? Date.now() + POLL_INTERVAL_MS;
}

/**
 * Returns a usable access_token for the account. If the cached token is
 * missing or within TOKEN_REFRESH_SKEW_MS of expiry, calls Google to refresh
 * and updates the DB. Throws on authorization errors so the caller can mark
 * the account as 'expired'.
 */
async function getValidAccessToken(
  accountId: string,
  account: {
    platform: string;
    oauth_access_token: string | null;
    oauth_refresh_token: string;
    token_expires_at: number | null;
  },
  deps: PollDeps,
): Promise<string> {
  // Non-YouTube publishers take the stored access token verbatim. Mock tokens
  // are static (the API mints them once at connect time and never rotates).
  // Real TikTok / IG / FB tokens would have their own refresh flow, but
  // those publishers fall through to stubUpload until real credentials + app
  // review land; refreshing them here would break the mock path.
  // For real credentials, we should check expiry to avoid using expired tokens.
  if (account.platform !== 'youtube') {
    if (!account.oauth_access_token) {
      throw new Error(`${account.platform}: no access token stored`);
    }
    // Check token expiry for non-YouTube platforms when real credentials are used
    const expiresAt = account.token_expires_at ?? 0;
    if (expiresAt > 0 && Date.now() >= expiresAt - TOKEN_REFRESH_SKEW_MS) {
      throw new Error(`${account.platform}: access token expired or near expiry`);
    }
    try {
      return decrypt(account.oauth_access_token, env.tokenEncryptionKey);
    } catch (err) {
      throw new Error(
        `${account.platform}: decrypt failed (${err instanceof Error ? err.message : 'unknown'})`,
      );
    }
  }

  // YouTube token handling with refresh logic
  const youtubeExpiresAt = account.token_expires_at ?? 0;
  if (
    account.oauth_access_token &&
    youtubeExpiresAt > 0 &&
    Date.now() < youtubeExpiresAt - TOKEN_REFRESH_SKEW_MS
  ) {
    try {
      return decrypt(account.oauth_access_token, env.tokenEncryptionKey);
    } catch {
      // Stored ciphertext is corrupt — fall through and try to refresh.
    }
  }
  const refreshToken = decrypt(account.oauth_refresh_token, env.tokenEncryptionKey);
  const fresh = await deps.google.refresh(refreshToken);
  const encryptedAccess = encrypt(fresh.access_token, env.tokenEncryptionKey);
  deps.accounts.updateTokens(accountId, {
    access_token: encryptedAccess,
    expires_at: fresh.expires_at,
  });
  return fresh.access_token;
}

async function processOne(claim: ClaimedScheduledPost, deps: PollDeps): Promise<void> {
  // OPT-1: the claim already carries post + account + video. The previous
  // version re-issued three findById queries per claim (line 168-171); with
  // the JOINed claim that work is folded into claimDuePosts' single batch
  // SELECT. Now we still re-check that the account is still active — its
  // status could have flipped to 'expired' between claim and dispatch.
  const { account, video, id: postId } = claim;
  if (account.status === 'expired') {
    // User revoked access on Google Account; can't recover automatically.
    deps.posts.markFailed(postId, 'account_expired_reconnect_required');
    console.warn(`[worker] skipping ${postId}: account ${account.id} expired`);
    return;
  }
  if (account.status !== 'active') {
    deps.posts.markFailed(postId, `account_${account.status}`);
    return;
  }
  // Quota check (Phase 3). Wrap in try/catch so an unexpected DB error
  // (e.g. concurrent quota-row create during a day rollover) doesn't
  // leave the post stuck in 'uploading' — retry, and let the next tick
  // re-evaluate once the racing write has settled.
  try {
    if (!deps.quotas.hasRemaining(account.platform)) {
      deps.posts.scheduleRetry(postId, 'quota_exhausted', Date.now());
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.posts.scheduleRetry(postId, `quota_check_failed: ${msg}`, Date.now());
    console.warn(`[worker] quota check failed for ${postId}: ${msg}`);
    return;
  }

  const publisher = getPublisher(account.platform);
  if (!publisher) {
    deps.posts.markFailed(postId, `no_publisher_for_${account.platform}`);
    return;
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(
      account.id,
      {
        platform: account.platform,
        oauth_access_token: account.oauth_access_token,
        oauth_refresh_token: account.oauth_refresh_token,
        token_expires_at: account.token_expires_at,
      },
      deps,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isRevoked(err)) {
      deps.accounts.updateStatus(account.id, 'expired');
      deps.posts.markFailed(postId, `account_expired:${msg}`);
      console.error(`[worker] account ${account.id} expired: ${msg}`);
    } else {
      deps.posts.scheduleRetry(postId, `token_refresh_failed: ${msg}`, Date.now());
      console.warn(`[worker] token refresh failed for ${postId}: ${msg}`);
    }
    return;
  }

  const meta = {
    ...parseCaption(claim.caption, claim.visibility),
    // Pass the account's external_id (IG user id / FB page id) so the
    // Meta publishers know which graph node to target. video_url is
    // left empty until the API exposes a public file route; the
    // Instagram publisher throws clearly when it's missing.
    external_id: account.external_id,
    video_url: '',
  };
  const validation = publisher.validate(meta, video);
  if (!validation.ok) {
    deps.posts.markFailed(postId, `validation_failed: ${validation.errors.join(', ')}`);
    return;
  }

  try {
    const result = await publisher.upload({
      access_token: accessToken,
      video,
      meta,
    });
    deps.posts.markPublished(postId, result.external_id);
    deps.quotas.incrementUsage(account.platform, 1);
    console.log(`[worker] published ${postId} -> ${result.external_id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    
    // Capture error to Sentry for monitoring
    if (err instanceof Error) {
      captureException(err, {
        postId,
        accountId: account.id,
        platform: account.platform,
        errorType: isRevoked(err) ? 'revoked' : isRetryable(err) ? 'retryable' : 'unknown',
      });
    }
    
    if (isRevoked(err)) {
      // Upload hit an auth failure even after a fresh refresh — the token is
      // definitively dead (user revoked / OAuth app unpublished). Mark so we
      // don't retry forever and the user can be told to reconnect.
      deps.accounts.updateStatus(account.id, 'expired');
      deps.posts.markFailed(postId, `account_expired:${msg}`);
      console.error(`[worker] account ${account.id} expired during upload: ${msg}`);
    } else if (isRetryable(err)) {
      deps.posts.scheduleRetry(postId, msg, Date.now());
      console.warn(`[worker] transient failure ${postId}: ${msg}`);
    } else {
      deps.posts.markFailed(postId, msg);
      console.error(`[worker] failed ${postId}: ${msg}`);
    }
  }
}

/** Network / 5xx / quota / rate-limit → back off and retry. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return /(network|timeout|ETIMEDOUT|ECONNRESET|5\d\d|rate.?limit|quota)/i.test(m);
}

/**
 * Authorization-side failures: the user revoked the OAuth grant or the
 * refresh token is no longer valid. These are not retryable — the only fix
 * is for the user to reconnect through the web UI.
 */
function isRevoked(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return /(invalid_grant|token.?revoked|revoked|unauthorized|401|403)/i.test(m);
}

function parseCaption(
  caption: string,
  visibility: 'public' | 'unlisted' | 'private',
): {
  title: string;
  description: string;
  caption: string;
  tags?: string[];
  visibility: 'public' | 'unlisted' | 'private';
} {
  const lines = caption.split(/\r?\n/, 2);
  const title = (lines[0] ?? caption).slice(0, 100);
  const description = (lines[1] ?? '').trim();
  const tags = Array.from(caption.matchAll(/#(\w+)/g))
    .map((m) => m[1])
    .filter((t): t is string => Boolean(t));
  return { title, description, caption, tags, visibility };
}

export interface EmbeddedWorkerHandle {
  /** Signal the poll loop to stop after the current iteration. */
  stop(): void;
}

/**
 * In-process worker for single-process deployments (e.g. the Docker image).
 * Shares the caller's DB handle instead of opening a second sql.js
 * instance — with one in-memory snapshot there is no cross-process export
 * race at all. The API starts this when EMBEDDED_WORKER=true.
 */
export function startEmbeddedWorker(db: DB): EmbeddedWorkerHandle {
  const deps: PollDeps = {
    db,
    accounts: new AccountsRepo(db),
    posts: new ScheduledPostsRepo(db),
    videos: new VideosRepo(db),
    quotas: new QuotasRepo(db),
    google: createGoogleClient({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      redirectUri: env.googleRedirectUri,
    }),
  };
  const unstuck = deps.posts.unstickUploading(UNSTICK_AFTER_MS, Date.now());
  if (unstuck > 0) {
    console.log(`[worker] unstuck ${unstuck} posts from previous crash`);
  }
  let stopping = false;
  void (async () => {
    console.log('[worker] embedded poll loop started');
    while (!stopping) {
      let nextDue: number;
      try {
        nextDue = await pollOnce(deps);
      } catch (err) {
        console.error('[worker] poll error', err);
        nextDue = Date.now() + POLL_INTERVAL_MS;
      }
      const sleepMs = Math.max(0, Math.min(nextDue - Date.now(), POLL_INTERVAL_MS));
      await wait(Math.max(1000, sleepMs));
    }
    console.log('[worker] embedded poll loop stopped');
  })();
  return {
    stop: () => {
      stopping = true;
    },
  };
}

const isMain = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`;
if (isMain) {
  runWorker().catch((err) => {
    console.error('[worker] fatal', err);
    process.exit(1);
  });
}

/**
 * Run async tasks with a hard concurrency cap. Starts up to `limit` tasks at
 * once; whenever one finishes, the next pending id is pulled. Errors in one
 * task are logged but never block the others — each `processOne` already
 * classifies its own errors and writes the outcome to the DB.
 */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = items.slice();
  const inflight = new Set<Promise<void>>();
  while (queue.length > 0 || inflight.size > 0) {
    while (inflight.size < limit && queue.length > 0) {
      const item = queue.shift()!;
      const p = fn(item)
        .catch((err) => {
          console.error('[worker] processOne threw (unhandled)', err);
        })
        .finally(() => {
          inflight.delete(p);
        });
      inflight.add(p);
    }
    if (inflight.size > 0) {
      await Promise.race(inflight);
    }
  }
}
