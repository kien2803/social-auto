/**
 * SPA OAuth popup opener + receiver. Pairs with `core/api/src/auth/popupClose.ts`:
 * the SPA opens a child window on /api/auth/<platform>/start?popup=1, the
 * popup's OAuth chain ends on /auth/popup-close, which postMessages the
 * result back to window.opener. This module wraps both halves behind a
 * single Promise.
 *
 * If the popup is blocked or the message never arrives (network error,
 * user closed the popup mid-flow), the helper falls back to a full-page
 * navigation so the connect flow still completes — at the cost of a page
 * reload, which is exactly what the popup-mode was meant to avoid.
 */
import {
  POPUP_MESSAGE_TYPE,
  POPUP_QUERY,
  type OAuthPopupMessage,
  type OAuthPopupResult,
} from '@social-auto/shared';


export interface OpenOAuthPopupOptions {
  /** Path the popup loads. Usually `/api/auth/<platform>/start?popup=1`. */
  startUrl: string;
  /** Fallback full-page URL when popups are blocked or the message never arrives. */
  fallbackUrl: string;
  /** ms to wait for the postMessage before falling back. Default 5 minutes. */
  timeoutMs?: number;
}

/**
 * Open a popup window for the OAuth flow and resolve with the postMessage
 * payload the popup-close page emits. Rejects (and triggers the fallback)
 * when:
 *   - the browser blocks the popup window,
 *   - the user closes the popup before the flow finishes,
 *   - the message arrives with an unexpected `type` or origin,
 *   - the timeout elapses.
 */
export function openOAuthPopup(opts: OpenOAuthPopupOptions): Promise<OAuthPopupResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  return new Promise<OAuthPopupResult>((resolve, reject) => {
    const popup = window.open(opts.startUrl, '_blank', 'popup,width=560,height=720');
    if (!popup) {
      reject(new Error('popup_blocked'));
      return;
    }
    const poll = { id: 0 };
    const finish = (cb: () => void): void => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      if (poll.id) window.clearInterval(poll.id);
      cb();
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      const payload = extractOAuthResultFromMessage(event);
      if (!payload) return;
      finish(() => resolve(payload));
    };
    const timer = window.setTimeout(() => {
      try {
        if (!popup.closed) popup.close();
      } catch {
        // ignore cross-origin close errors
      }
      finish(() => reject(new Error('popup_timeout')));
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    poll.id = window.setInterval(() => {
      if (popup.closed) finish(() => reject(new Error('popup_closed_by_user')));
    }, 500);
  });
}

/** Build /api/auth/<platform>/start?popup=1 — the popup-mode entry URL. */
export function buildOAuthStartUrl(platform: string): string {
  const base = `/api/auth/${encodeURIComponent(platform)}/start`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${POPUP_QUERY}=1`;
}

/**
 * Validate that a postMessage event came from the popup-close page on
 * the same origin and extract the OAuth result payload. Returns the
 * payload on success, or `null` if the message should be ignored
 * (wrong origin, wrong type, missing payload).
 *
 * Used by both `openOAuthPopup` (to resolve its Promise) and by the
 * AccountsPage listener (to react to popup results without re-opening
 * a popup). Centralizing the validation here keeps the literal
 * `POPUP_MESSAGE_TYPE` and the origin check in one place.
 */
export function extractOAuthResultFromMessage(
  event: MessageEvent<unknown>,
): OAuthPopupResult | null {
  if (event.origin !== window.location.origin) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const msg = data as Partial<OAuthPopupMessage>;
  if (msg.type !== POPUP_MESSAGE_TYPE) return null;
  return msg.payload ?? null;
}