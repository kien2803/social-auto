/**
 * Contract for the Meta (Facebook + Instagram) OAuth client.
 *
 * Meta's flow differs from Google's and TikTok's in important ways:
 *   - One Facebook Login OAuth produces a single user access token that
 *     can be exchanged for *long-lived* tokens (60-day) and per-Page
 *     access tokens needed to publish.
 *   - Both Facebook Pages and Instagram Business accounts are scoped
 *     separately. A user can have many Facebook Pages, each with its
 *     own page access token. An IG Business account is linked to a
 *     Facebook Page.
 *   - The simplest "one social-auto row per (platform, page/ig-id)" model
 *     is: after the user finishes Facebook Login, we call /me/accounts
 *     to enumerate their Pages + linked IG business accounts, and let
 *     the user pick which one(s) to connect.
 *
 * For the worker, what matters is the per-account `access_token` stored
 * in the DB (already a page access token with `pages_manage_posts` /
 * `instagram_content_publish`). This client surfaces that as
 * `verifyCredentials`.
 */
export interface MetaTokens {
  /** Short-lived (~2h) user access token returned by the OAuth exchange. */
  access_token: string;
  /** Long-lived (~60d) user access token after `oauth/access_token?grant_type=fb_exchange_token`. */
  long_lived_token?: string;
  /** Unix epoch in milliseconds when `access_token` expires. */
  expires_at?: number;
}

export interface MetaPage {
  /** Facebook Page id. */
  id: string;
  name: string;
  /** Page access token with `pages_manage_posts` (and IG if linked). */
  access_token: string;
  /** Linked Instagram Business account id, when present. */
  instagram_business_account_id?: string;
  /** Linked Instagram Business account username (handle). */
  instagram_username?: string;
  /** Profile picture URL. */
  picture_url?: string;
}

export interface MetaUser {
  /** Facebook user id. */
  id: string;
  name: string;
  /** Profile picture URL. */
  picture_url?: string;
}

export interface MetaOAuthClient {
  buildAuthUrl(state: string): string;
  /** Exchange `code` for a short-lived user access token. */
  exchangeCode(code: string): Promise<MetaTokens>;
  /**
   * Exchange a short-lived user access token for a long-lived one
   * (~60 days). Should be called once during the OAuth callback before
   * we hand the token to the worker.
   */
  exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaTokens>;
  /** Return the logged-in user's basic profile. */
  getMyUser(accessToken: string): Promise<MetaUser>;
  /**
   * Enumerate the user's Facebook Pages (and linked IG business accounts).
   * The returned page tokens are the ones the worker will use to publish.
   */
  listMyPages(accessToken: string): Promise<MetaPage[]>;
  /** Refresh a long-lived user token (extends another 60 days). */
  refreshLongLivedToken(longLivedToken: string): Promise<MetaTokens>;
}
