/**
 * Lightweight client-side telemetry for activity tracking + error reporting.
 *
 * Goals:
 * - Surface every user-initiated action in DevTools with a stable prefix so
 *   the user can grep their own console and see what they did.
 * - Classify failures so console output answers "what kind of problem is
 *   this?" without reading the stack — a single token like
 *   `[api:http_404]` is faster to scan than a full trace.
 *
 * All output goes to the browser console via `console.info / console.warn /
 * console.error`. No remote sink yet — that's intentional, remote sinks
 * need a transport decision (Sentry? Logflare? local log file via the
 * API?). When that decision lands, swap `emit()` and the rest of the code
 * keeps working.
 *
 * Conventions:
 * - `track()` covers a user action or app lifecycle event. Console INFO.
 * - `warnValidation()` covers client-side rejections the user can fix
 *   (empty form, bad URL). Console WARN. Stays out of the "error" bucket
 *   because nothing actually broke.
 * - `reportError()` covers anything unexpected — network failures, server
 *   errors, parse failures, thrown exceptions. Console ERROR.
 *
 * Field normalization: every event accepts an optional `fields` bag. All
 * keys are lowercased + prefixed with the source so they read like
 * `[ui] click Connect YouTube {platform: "youtube", surface: "header"}`.
 */

// ────────────────────────────────────────────────────────────────────────────
// Error taxonomy
// ────────────────────────────────────────────────────────────────────────────

export type ErrorKind =
  /** fetch() threw (server down, CORS, offline). */
  | 'network'
  /** 4xx that wasn't auth/not-found — usually bad input. */
  | 'http_4xx'
  /** 401 / 403 — credentials missing, expired, or insufficient scope. */
  | 'http_auth'
  /** 404 — resource gone or wrong URL. */
  | 'http_404'
  /** 5xx — server-side fault, retry may help. */
  | 'http_5xx'
  /** Response wasn't JSON or didn't match the expected shape. */
  | 'parse'
  /** Zod / react-hook-form / pre-flight rejection. */
  | 'validation'
  /** User explicitly denied an action (cancel, dismiss, abort). */
  | 'abort'
  /** Catch-all — kind not yet classified. */
  | 'unknown';

export interface ReportFields {
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

const NS = '[ui]';

function ts(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function flatten(source: string, fields?: ReportFields): Record<string, unknown> {
  if (!fields) return { source };
  // Prefix unknown keys with the source so DevTools groups them clearly.
  const out: Record<string, unknown> = { source };
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v;
  }
  return out;
}

function emit(
  level: 'info' | 'warn' | 'error',
  message: string,
  payload: Record<string, unknown>,
): void {
  // Choose a console method per level — DevTools gives info a different
  // badge from warn from error so the user can scan severity visually.
  //
  // `%s` substitutes the tag as a string (consistent across browsers —
  // Edge/Chrome/Firefox all expand `%o` for objects but Chrome is the
  // most permissive). `%o` formats the payload as an expandable object.
  // Without the format specifiers some browsers (`console.info('msg',
  // {})`) print `[object Object]` instead of expanding — seen in Edge.
  const fn = console[level];
  if (typeof fn !== 'function') return;
  const tag = `${NS} ${message}`;
  if (level === 'info') {
    // `console.info` warns at TS because the variadic args typing is
    // narrow; the runtime accepts the format specifier.
    (fn as (...args: unknown[]) => void)('%s %o', tag, payload);
  } else if (level === 'warn') {
    (console.warn as (...args: unknown[]) => void)('%s %o', tag, payload);
  } else {
    (console.error as (...args: unknown[]) => void)('%s %o', tag, payload);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Record a user action or app lifecycle event. Console INFO.
 *
 * @param action  Stable identifier — prefer "verb noun" form:
 *                "click Connect YouTube", "submit schedule form",
 *                "navigate /accounts". Used as the human-readable label
 *                in DevTools.
 * @param fields  Optional structured fields (platform, surface, ids, …).
 */
export function track(action: string, fields?: ReportFields): void {
  emit('info', `${ts()} ${action}`, flatten(action, fields));
}

/**
 * Record a client-side validation rejection the user can fix. Console WARN.
 * Use this when the user submitted a form with a missing field, picked a
 * disallowed file type, etc. — nothing actually failed, we just refused
 * to do the work and told them why.
 */
export function warnValidation(action: string, fields?: ReportFields): void {
  emit('warn', `${ts()} ${action}`, { ...flatten(action, fields), kind: 'validation' });
}

/**
 * Classify and report an unexpected failure. Console ERROR.
 *
 * @param kind    Coarse failure type. Use the ErrorKind union.
 * @param source  Where the error came from — `api.listAccounts`, the OAuth
 *                redirect, the CSV importer, etc. Used as a label, not a
 *                stack-trace replacement.
 * @param error   The original error (Error, ApiError, FetchError, anything).
 * @param fields  Optional structured context — request URL, status, ids.
 */
export function reportError(
  kind: ErrorKind,
  source: string,
  error: unknown,
  fields?: ReportFields,
): void {
  const { message, stack } = normalizeError(error);
  emit('error', `${ts()} ${source} — ${kind}: ${message}`, {
    ...flatten(source, fields),
    kind,
    message,
    stack,
  });
}

/**
 * Install global error handlers. Idempotent — calling twice won't double-
 * subscribe because we keep a flag on the function itself.
 *
 * What this catches:
 *   - `window.error` — synchronous throws outside React (e.g. an event
 *     listener throws). React render-time throws are caught by an
 *     ErrorBoundary (not added here — separate concern).
 *   - `window.unhandledrejection` — promises rejected without a .catch().
 *     TanStack Query mutations shouldn't hit this in practice (their
 *     `onError` always fires) but background timers / fetch in effects can.
 *
 * Reports go through `reportError` with kind `unknown` for the raw
 * event. The original `Error` (or string, or whatever was thrown) is
 * forwarded as-is.
 */
export function installWindowErrorHandlers(): void {
  const w = typeof window === 'undefined' ? null : window;
  if (!w) return;
  const flag = '__social_auto_telemetry_installed__';
  // Attach a sentinel so dev-mode StrictMode (double-mount) doesn't pile
  // up duplicate handlers.
  const w2 = w as unknown as Record<string, unknown>;
  if (w2[flag]) return;
  w2[flag] = true;

  w.addEventListener('error', (event) => {
    reportError('unknown', 'window.error', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  w.addEventListener('unhandledrejection', (event) => {
    reportError('unknown', 'window.unhandledrejection', event.reason, {
      reason: typeof event.reason === 'string' ? event.reason : 'non-string rejection',
    });
  });
}

/**
 * Best-effort Error normalization. Some thrown values are strings, some
 * are plain objects (DOMException, FetchError), some have nested `cause`.
 * Returns a printable message + stack for the console.
 */
function normalizeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  if (typeof err === 'string') return { message: err };
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; toString?: () => string };
    const message = typeof e.message === 'string' ? e.message : String(err);
    return { message };
  }
  return { message: String(err) };
}

/**
 * Classify a fetch failure into an ErrorKind. Pure function so callers
 * don't have to duplicate the status-code mapping.
 *
 * - 401 / 403 → http_auth
 * - 404 → http_404
 * - Other 4xx → http_4xx
 * - 5xx → http_5xx
 * - null status (fetch threw) → network
 */
export function classifyHttpError(status: number | null): ErrorKind {
  if (status == null) return 'network';
  if (status === 401 || status === 403) return 'http_auth';
  if (status === 404) return 'http_404';
  if (status >= 400 && status < 500) return 'http_4xx';
  if (status >= 500) return 'http_5xx';
  return 'unknown';
}
