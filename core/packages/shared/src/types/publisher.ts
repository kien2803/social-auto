import type { Platform } from './platform.js';
import type { Visibility } from '../db/schema.js';

export interface UploadMeta {
  /** First line of `caption` — used as the video title. */
  title: string;
  /** Title removed + hashtags extracted — used as the description / caption body. */
  description: string;
  /** Per-platform caption override (may differ from base). */
  caption: string;
  tags?: string[];
  visibility: Visibility;
  /**
   * Optional public URL where the video is reachable. Required for
   * platforms that pull (Instagram Reels via the Graph API). The worker
   * populates this by serving the local file from a public route.
   */
  video_url?: string;
  /**
   * For Meta: the IG business account id or Facebook Page id that should
   * receive the post. The auth callback stored the id as the row's
   * `external_id`; the worker passes it through here so the publisher
   * can target the right graph node.
   */
  external_id?: string;
}

export interface PublisherUploadResult {
  external_id: string;
  /** Optional URL where the post can be viewed. */
  url?: string;
}

export interface PublisherValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Each platform implements this. The worker dispatches to the right publisher by
 * `account.platform`.
 *
 * Phase 2 introduces the abstraction; Phase 1 had YouTube-only logic baked into
 * the worker and is refactored here.
 */
export interface Publisher {
  readonly platform: Platform;
  /**
   * Validate meta + account before scheduling. Used at submit time so users get
   * immediate feedback.
   */
  validate(meta: UploadMeta, video: PublisherVideo): PublisherValidation;
  /**
   * Upload to the platform. Returns the external post id; throws on failure.
   * Token refresh is the publisher's responsibility.
   */
  upload(input: PublisherInput): Promise<PublisherUploadResult>;
}

export interface PublisherInput {
  access_token: string;
  video: PublisherVideo;
  meta: UploadMeta;
}

export interface PublisherVideo {
  file_path: string;
  size_bytes: number;
  mime: string;
  duration_sec: number | null;
}

/** Per-platform caption limits (Phase 2). */
export const PLATFORM_CAPTION_LIMITS: Record<Platform, number> = {
  youtube: 5000,
  tiktok: 2200,
  instagram: 2200,
  facebook: 2200,
};

/** Per-platform title limits (Phase 2). YouTube only. */
export const PLATFORM_TITLE_LIMITS: Record<Platform, number> = {
  youtube: 100,
  tiktok: 150,
  instagram: 150,
  facebook: 150,
};

/** Per-platform max video duration in seconds (Phase 2). */
export const PLATFORM_MAX_DURATION_SEC: Record<Platform, number> = {
  youtube: 12 * 60 * 60,
  tiktok: 10 * 60,
  instagram: 90,
  facebook: 90 * 60,
};
