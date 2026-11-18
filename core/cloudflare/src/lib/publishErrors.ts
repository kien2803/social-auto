/** Publish-error classification — decides whether a failed attempt is worth
 *  retrying and how the Control Center explains it.
 *
 *  Categories (user-facing):
 *    token_expired       — 401 / revoked / refresh failed → reconnect required
 *    invalid_video       — platform rejected the media/meta → fix the content
 *    missing_permission  — 403 forbidden / insufficient scope
 *    rate_limited        — 429 / quota exhausted → retry after a long backoff
 *    duplicate           — platform says the post already exists
 *    transient           — 5xx / network / timeout → retry with backoff
 *
 *  Check ORDER matters: quota errors often carry 403 — test rate_limit
 *  before permission, and auth before validation. */
export type ErrorCategory =
  | 'token_expired'
  | 'invalid_video'
  | 'missing_permission'
  | 'rate_limited'
  | 'duplicate'
  | 'transient';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
}

export function categorizePublishError(err: unknown): ClassifiedError {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Rate limits first — YouTube quota exhaustion arrives as a 403, which
  // would otherwise be misclassified as missing_permission.
  if (/429|rate.?limit|quota|throttl|too.?many|userrequest|daily limit/.test(m)) {
    return { category: 'rate_limited', retryable: true };
  }
  // Auth/token — retrying can't help; the user must reconnect.
  if (/401|unauthorized|invalid_token|expired_token|token.*expired|invalid_grant|revoked|reconnect|token_refresh_failed/.test(m)) {
    return { category: 'token_expired', retryable: false };
  }
  // Platform says the post exists already — never double-post.
  if (/duplicate|already_(published|uploaded|exists)|idempot/.test(m)) {
    return { category: 'duplicate', retryable: false };
  }
  if (/403|forbidden|insufficient|permission|scope|banned/.test(m)) {
    return { category: 'missing_permission', retryable: false };
  }
  // Media/meta rejects — the platform will say no again next time.
  // TikTok fail_reasons arrive as snake_case (video_duration_check_failed…).
  if (/invalid_|unsupported|too_long|missing_|bad_request|400|validation|format|size_mismatch|check_failed/.test(m)) {
    return { category: 'invalid_video', retryable: false };
  }
  return { category: 'transient', retryable: true };
}

/** Legacy two-way split kept for callers that only want retry-vs-done. */
export type ErrorClass = 'retryable' | 'permanent';
export function classifyPublishError(err: unknown): ErrorClass {
  return categorizePublishError(err).retryable ? 'retryable' : 'permanent';
}

/** Hard bound on publish attempts per post — a poison post can't loop forever. */
export const MAX_PUBLISH_ATTEMPTS = 5;

/**
 * Backoff schedule for released retries (ms after which the cron re-claims
 * the post). Rate-limited errors park much longer — quota resets are
 * daily/hourly, not seconds.
 */
const TRANSIENT_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 8 * 3600_000] as const;
const RATE_LIMIT_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 4 * 3600_000, 12 * 3600_000] as const;

export function retryBackoffMs(category: ErrorCategory, retryCount: number): number {
  const table = category === 'rate_limited' ? RATE_LIMIT_BACKOFF_MS : TRANSIENT_BACKOFF_MS;
  return table[Math.min(retryCount, table.length - 1)]!;
}
