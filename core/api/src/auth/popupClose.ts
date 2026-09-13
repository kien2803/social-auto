/**
 * OAuth popup-mode close page.
 *
 * Flow:
 *   1. SPA opens a popup to /api/auth/<platform>/start?popup=1
 *   2. The OAuth callback runs, then 302-redirects to /auth/popup-close?result=<base64>
 *      instead of redirecting back to the SPA at /accounts?connected=...
 *   3. This handler returns a tiny HTML page that:
 *        a. parses `result` from the query string,
 *        b. postMessages the payload to window.opener (the SPA tab),
 *        c. closes itself.
 * Why the SPA doesn't just react to its own URL: any redirect to /accounts?...
 * after the OAuth chain re-mounts React Router and full-page reloads, killing
 * the user's scroll position / search filter / focus state. The popup-mode
 * keeps the parent tab stable.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { POPUP_MESSAGE_TYPE } from '@social-auto/shared';

/** Cookie name set on the popup window during the OAuth round-trip. */
export const POPUP_COOKIE = 'oauth_popup';
/** Query the SPA sends on /auth/<platform>/start to opt into popup mode. */
export const POPUP_QUERY = 'popup';

/**
 * Names of every OAuth cookie a callback route may set. Used by
 * `clearOrphanOAuthCookies` to wipe the lot on any 4xx/5xx response.
 */
export const OAUTH_COOKIE_NAMES = [
  'oauth_state',
  'oauth_popup',
  'oauth_pkce_verifier',
] as const;

/**
 * Mount an `onSend` hook that clears every OAuth cookie on a 4xx/5xx
 * response from any /auth/* route. Covers state-mismatch, missing-code,
 * PKCE-verifier-missing, and any other error branch uniformly so a
 * failed OAuth round-trip never leaves a stale cookie on the browser.
 *
 * Each platform's `registerAuthRoutes` mounts this once near the top
 * of the route group — Fastify permits multiple `onSend` hooks and
 * the duplicates are idempotent (clearCookie on an absent cookie is
 * a no-op).
 */
const ORPHAN_COOKIE_HOOK_KEY = Symbol.for('@social-auto/api/orphan-cookie-hook');

export function clearOrphanOAuthCookies(app: FastifyInstance): void {
  // Idempotent across register* calls: Fastify appends `onSend` hooks each
  // time, and three duplicates racing on reply headers caused a
  // ERR_HTTP_HEADERS_SENT crash. Track installation on the Fastify instance
  // itself so we install exactly once per app, no matter how many
  // registerAuthRoutes callers mount this helper.
  if ((app as unknown as Record<symbol, boolean>)[ORPHAN_COOKIE_HOOK_KEY]) return;
  (app as unknown as Record<symbol, boolean>)[ORPHAN_COOKIE_HOOK_KEY] = true;
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.url.startsWith('/auth/')) return payload;
    if (reply.statusCode < 400) return payload;
    for (const name of OAUTH_COOKIE_NAMES) {
      reply.clearCookie(name, { path: '/auth' });
    }
    return payload;
  });
}

/**
 * Hard ceiling on the encoded popup-close payload (base64url). The
 * static page postMessages the decoded JSON to window.opener; a runaway
 * payload (e.g. a callback that stuffed request bodies into `result`)
 * would either blow past the 2 KB browser-URL practical limit or be
 * dropped silently by intermediaries. 2 KB of base64 is ~1.5 KB of
 * JSON — enough for `{ connected, account_ids }` with a couple of
 * UUIDs, and tight enough that a real misconfiguration is loud.
 */
const MAX_ENCODED_POPUP_RESULT_BYTES = 2048;

/**
 * Serialize the popup-close redirect payload into a base64url-encoded JSON
 * blob suitable for a query string. Keeps the URL self-contained so the
 * static page can decode it without a server round-trip. Throws when the
 * encoded blob exceeds the size ceiling so a misconfigured callback can
 * fail fast in tests instead of silently truncating at the browser.
 */
function encodeResult(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (encoded.length > MAX_ENCODED_POPUP_RESULT_BYTES) {
    throw new Error(
      `popup result exceeds ${MAX_ENCODED_POPUP_RESULT_BYTES} byte cap (got ${encoded.length})`,
    );
  }
  return encoded;
}

/**
 * Decide where the post-callback redirect should land. When `popupMode` is
 * true (signaled by the oauth_popup cookie set by /start?popup=1), redirect
 * to /auth/popup-close so the popup can message the opener and close itself.
 * Otherwise fall back to the legacy /accounts?connected=... redirect that the
 * SPA's query-string useEffect consumes.
 */
export function buildAuthRedirect(
  popupMode: boolean,
  webRedirect: string,
  result: Record<string, unknown>,
): string {
  if (!popupMode) return webRedirect;
  const encoded = encodeResult(result);
  return `/auth/popup-close?result=${encoded}`;
}

/** Mark the popup cookie for clearing at the end of the callback. */
export function shouldClearPopupCookie(popupMode: boolean): boolean {
  return popupMode;
}

/**
 * Register the popup-close static page route. Must be mounted BEFORE the
 * OAuth start handlers so a stray OAuth callback that escaped /auth/<plat>/
 * start doesn't get intercepted by a wildcard.
 */
export function registerPopupCloseRoute(app: FastifyInstance): void {
  app.get('/auth/popup-close', async (_req, reply: FastifyReply) => {
    reply.type('text/html; charset=utf-8').send(POPUP_CLOSE_HTML);
  });
}

/**
 * HTML page returned by /auth/popup-close. Reads `?result=<base64url JSON>`
 * from the query, postMessages the decoded payload to window.opener (the SPA
 * tab), and closes the popup. CSP-safe: no inline event handlers, no eval,
 * no remote scripts.
 *
 * `POPUP_MESSAGE_TYPE` is embedded via JSON.stringify so the client and
 * server agree on the literal string without a separate import boundary.
 */
const POPUP_CLOSE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Connecting\u2026</title>
    <style>
      body { font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
             color: #475569; margin: 0; padding: 0; background: #f8fafc; }
      .wrap { display: flex; align-items: center; justify-content: center;
              height: 100vh; text-align: center; padding: 24px; box-sizing: border-box; }
      p { margin: 0; max-width: 320px; line-height: 1.4; }
      .fallback { color: #94a3b8; font-size: 12px; margin-top: 8px; }
      .ok    { color: #16a34a; font-weight: 600; }
      .err   { color: #b91c1c; font-weight: 600; }
      .spinner { width: 16px; height: 16px; border: 2px solid #cbd5e1;
                 border-top-color: #475569; border-radius: 50%;
                 display: inline-block; vertical-align: -3px;
                 margin-right: 8px; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div>
        <p id="status"><span id="statusIcon" class="spinner"></span><span id="statusText">Connecting\u2026</span></p>
        <p class="fallback" id="fallback" hidden>You can close this window.</p>
      </div>
    </div>
    <script>
      (function () {
        function getParam(name) {
          var m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
          return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : null;
        }
        function b64UrlDecode(s) {
          // base64url → base64 standard, with the right padding for atob.
          var std = s.replace(/-/g, '+').replace(/_/g, '/');
          while (std.length % 4 !== 0) std += '=';
          var bin = atob(std);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
          }
          // Decode the UTF-8 bytes back to a JS string. The legacy hack
          // for this was decodeURIComponent(escape(out)); escape() is
          // deprecated in modern runtimes, so use TextDecoder directly.
          return new TextDecoder('utf-8').decode(bytes);
        }
        var raw = getParam('result');
        var payload;
        try {
          payload = raw ? JSON.parse(b64UrlDecode(raw)) : { error: 'no_result' };
        } catch (err) {
          payload = { error: 'decode_failed', detail: err && err.message || String(err) };
        }
        var statusIcon = document.getElementById('statusIcon');
        var statusText = document.getElementById('statusText');
        var fallback = document.getElementById('fallback');
        function setStatus(kind, msg) {
          if (!statusIcon || !statusText) return;
          statusIcon.className = kind; // 'ok' | 'err' | 'spinner'
          statusIcon.textContent = kind === 'ok' ? '\u2713' : (kind === 'err' ? '\u2716' : '');
          statusText.textContent = msg;
        }
        var target = window.opener;
        var sent = false;
        if (target && !target.closed) {
          try {
            target.postMessage(
              { type: ${JSON.stringify(POPUP_MESSAGE_TYPE)}, payload: payload },
              window.location.origin,
            );
            sent = true;
          } catch (err) {
            payload = { error: 'postMessage_failed', detail: err && err.message || String(err) };
            sent = false;
          }
        }
        if (!sent) {
          // Opener missing or postMessage failed: update status here, then
          // fall back to the SPA's query-string handler so the connect flow
          // still completes (with a page reload — better than silent fail).
          setStatus('err', 'Could not reach the app. Finishing on the main tab.');
          if (fallback) fallback.hidden = false;
          var qs = new URLSearchParams(payload).toString();
          setTimeout(function () {
            window.location.replace('/accounts' + (qs ? '?' + qs : ''));
          }, 1200);
          return;
        }
        // Success path — opener already received the postMessage. Show a
        // check mark briefly so the user sees the confirmation, then close.
        if (payload && payload.error) {
          setStatus('err', 'Could not connect: ' + (payload.error || 'unknown'));
        } else {
          setStatus('ok', 'Connected! You can close this window.');
        }
        if (fallback) fallback.hidden = false;
        setTimeout(function () { window.close(); }, 1600);
      })();
  </body>
</html>`;