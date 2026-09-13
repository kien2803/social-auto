import type { Platform } from './platform.js';

export type AccountStatus = 'active' | 'expired' | 'revoked';

/**
 * Free-form short tag the user picks to bucket the account's content
 * (e.g. "tech", "cooking"). Not validated; stored verbatim.
 */
export type AccountContentCategory = string;

/**
 * Spoken language the account publishes in. Kept as a small enum so the
 * import-export filter and the UI can offer a stable set; an empty string
 * means the user has not set one.
 */
export const ACCOUNT_LANGUAGE_CODES = ['ENGLISH', 'VIETNAMESE'] as const;
export type AccountLanguageCode = (typeof ACCOUNT_LANGUAGE_CODES)[number] | '';

/**
 * Metadata the user can attach to an account. All fields are optional and
 * safe to expose via the API; never include any token / credential here.
 */
export interface AccountMetadata {
  content_category: AccountContentCategory;
  language_code: AccountLanguageCode;
  purpose: string;
  link: string;
}

/**
 * Snapshot of public YouTube channel stats, refreshed on demand via
 * POST /accounts/:id/sync. Counts come from YouTube Data API and are
 * stored as numbers; null = not yet synced.
 */
export interface AccountChannelSnapshot {
  /** Channel handle, e.g. "@mychannel". */
  channel_handle: string;
  /** Default avatar / channel thumbnail URL. */
  avatar_url: string;
  /** Subscriber count, if public. null when unknown. */
  subscribers: number | null;
  /** Total view count, if public. null when unknown. */
  views: number | null;
  /** Public video count. null when unknown. */
  video_count: number | null;
  /** Sum of like_count across the channel's recent videos. null when unknown. */
  like_count: number | null;
  /** Average watch time per view, in seconds. null when unknown. */
  avg_watch_seconds: number | null;
  /** Audience drop-off fraction in [0, 1] (e.g. 0.42 = 42% left before midpoint). null when unknown. */
  drop_off_pct: number | null;
  /** Unix ms of the last successful sync. null = never synced. */
  last_sync_at: number | null;
}

export interface Account {
  id: string;
  platform: Platform;
  display_name: string;
  /** OAuth refresh token, encrypted at rest. */
  oauth_refresh_token: string;
  /** Cached access token, encrypted. Optional. */
  oauth_access_token: string | null;
  /** When the cached access token expires (unix ms). */
  token_expires_at: number | null;
  status: AccountStatus;
  /** ISO timestamp. */
  created_at: string;
  metadata: AccountMetadata;
  channel: AccountChannelSnapshot;
}
