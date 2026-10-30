/** Publish-error classification: decides whether a failed attempt is worth
 *  retrying. Permanent failures (bad credentials, validation, duplicates)
 *  go straight to failed/dead — retrying them burns quota and re-publishes
 *  nothing. Retryable failures (5xx, network, rate-limit, timeouts) use the
 *  queue's bounded retry then land on the DLQ → dead. */
export type ErrorClass = 'retryable' | 'permanent';

export function classifyPublishError(err: unknown): ErrorClass {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Auth / expired token — retrying can't help; the user must reconnect.
  if (/401|unauthorized|invalid_token|expired_token|token.*expired|reconnect/.test(m)) return 'permanent';
  // Already published elsewhere — never double-post.
  if (/duplicate|already_(published|uploaded|exists)|idempot/.test(m)) return 'permanent';
  // Validation rejects — the platform will say no again next time.
  if (/invalid_|unsupported|too_long|missing_|bad_request|400/.test(m)) return 'permanent';
  return 'retryable';
}

/** Hard bound on publish attempts per post, on top of the queue's own
 *  max_retries — belt-and-suspenders so a poison post can't loop forever. */
export const MAX_PUBLISH_ATTEMPTS = 5;
