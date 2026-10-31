/** Row types mirroring the sql.js schema — D1 returns rows as objects. */
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
export type Visibility = 'public' | 'unlisted' | 'private';
export type AccountStatus = 'active' | 'expired' | 'revoked';
export type ScheduledPostStatus = 'draft' | 'pending' | 'uploading' | 'published' | 'failed' | 'dead';

export interface AccountRow {
  id: string;
  user_id: string;
  platform: Platform;
  external_id: string;
  display_name: string;
  oauth_refresh_token: string;
  oauth_access_token: string | null;
  token_expires_at: number | null;
  status: AccountStatus;
  created_at: number;
  content_category: string;
  language_code: string;
  purpose: string;
  link: string;
  channel_handle: string;
  avatar_url: string;
  subscribers: number | null;
  views: number | null;
  video_count: number | null;
  like_count: number | null;
  avg_watch_seconds: number | null;
  drop_off_pct: number | null;
  last_sync_at: number | null;
}

export interface VideoRow {
  id: string;
  user_id: string;
  file_path: string;
  sha256: string;
  size_bytes: number;
  duration_sec: number | null;
  mime: string;
  thumbnail_path: string | null;
  created_at: number;
}

export interface ScheduledPostRow {
  id: string;
  user_id: string;
  video_id: string;
  account_id: string;
  scheduled_at: number;
  caption: string;
  per_platform_caption: string | null;
  visibility: Visibility;
  status: ScheduledPostStatus;
  external_post_id: string | null;
  last_error: string | null;
  retry_count: number;
  next_retry_at: number | null;
  notes: string | null;
  is_dead: number;
  created_at: number;
  updated_at: number;
}

/** Joined row used by the queue consumer — post + its account + video. */
export interface ClaimedPost extends ScheduledPostRow {
  account: AccountRow;
  video: VideoRow;
}
