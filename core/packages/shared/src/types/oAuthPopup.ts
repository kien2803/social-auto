/**
 * OAuth popup-mode wire contract shared between the API (sender) and the
 * web client (receiver). Kept in @social-auto/shared so neither side can
 * drift out of sync with the literal strings they exchange over postMessage.
 *
 * The flow:
 *   1. SPA opens /api/auth/<platform>/start?popup=1 in a popup window.
 *   2. OAuth round-trip ends on /auth/callback; the API sees the
 *      oauth_popup cookie set by /start and 302-redirects the popup to
 *      /auth/popup-close?result=<base64url JSON>.
 *   3. The popup-close page decodes `result` and postMessages the payload
 *      to its opener (window.opener, the SPA tab). The SPA's listener
 *      validates the message type and origin before reacting.
 *   4. If the popup was blocked or window.opener is gone, the popup-close
 *      page does window.location.replace(/accounts?...), preserving the
 *      legacy full-page flow as a fallback.
 */

/** Literal postMessage `type` field. Both sides reference the same constant. */
export const POPUP_MESSAGE_TYPE = 'social-auto:oauth-result';

/** Query string appended to /auth/<platform>/start to opt into popup mode. */
export const POPUP_QUERY = 'popup';

/** Cookie name the API sets when popup mode is active. */
export const POPUP_COOKIE = 'oauth_popup';

/** Payload shape carried inside the postMessage. */
export interface OAuthPopupResult {
  /** Platform slug ("youtube" | "tiktok" | "instagram" | "facebook" | "meta"). */
  connected?: string;
  /** Single-account flow: the new/updated account row id. */
  account_id?: string;
  /** Multi-account flow (Meta): comma-separated ids in legacy form, array in popup form. */
  account_ids?: string[];
  /** Error description, present only on failure. */
  error?: string;
  /** Auxiliary debugging info (decode failure, postMessage failure). */
  detail?: string;
}

/** postMessage envelope the SPA receives from the popup-close page. */
export interface OAuthPopupMessage {
  type: typeof POPUP_MESSAGE_TYPE;
  payload: OAuthPopupResult;
}