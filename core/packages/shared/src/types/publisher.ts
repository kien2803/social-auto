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

/** Per-platform video optimization requirements (Phase 3). */
export interface PlatformVideoRequirements {
  /** Preferred codec */
  codec: string;
  /** Maximum resolution (width x height) */
  maxResolution: [number, number];
  /** Preferred resolution */
  preferredResolution: [number, number];
  /** Maximum bitrate in kbps */
  maxBitrate: number;
  /** Preferred bitrate in kbps */
  preferredBitrate: number;
  /** Supported frame rates */
  frameRates: number[];
  /** Aspect ratio requirements */
  aspectRatios: string[];
}

/** Platform-specific video requirements (Phase 3). */
export const PLATFORM_VIDEO_REQUIREMENTS: Record<Platform, PlatformVideoRequirements> = {
  youtube: {
    codec: 'h264',
    maxResolution: [3840, 2160], // 4K
    preferredResolution: [1920, 1080], // 1080p
    maxBitrate: 50000, // 50 Mbps
    preferredBitrate: 8000, // 8 Mbps
    frameRates: [24, 25, 30, 60],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  tiktok: {
    codec: 'h264',
    maxResolution: [1080, 1920], // 1080x1920 vertical
    preferredResolution: [1080, 1920], // 1080x1920 vertical
    maxBitrate: 12000, // 12 Mbps
    preferredBitrate: 6000, // 6 Mbps
    frameRates: [24, 30, 60],
    aspectRatios: ['9:16', '1:1'],
  },
  instagram: {
    codec: 'h264',
    maxResolution: [1080, 1920], // 1080x1920 vertical
    preferredResolution: [1080, 1080], // 1:1 square
    maxBitrate: 15000, // 15 Mbps
    preferredBitrate: 5000, // 5 Mbps
    frameRates: [24, 30, 60],
    aspectRatios: ['1:1', '4:5', '9:16'],
  },
  facebook: {
    codec: 'h264',
    maxResolution: [1920, 1080], // 1080p
    preferredResolution: [1280, 720], // 720p
    maxBitrate: 8000, // 8 Mbps
    preferredBitrate: 4000, // 4 Mbps
    frameRates: [24, 30, 60],
    aspectRatios: ['16:9', '1:1', '4:5'],
  },
};

/** Validate video against platform requirements (Phase 3). */
export function validateVideoForPlatform(
  platform: Platform,
  video: PublisherVideo,
): { valid: boolean; issues: string[] } {
  const requirements = PLATFORM_VIDEO_REQUIREMENTS[platform];
  const issues: string[] = [];
  
  // Duration check
  if (video.duration_sec !== null) {
    const maxDuration = PLATFORM_MAX_DURATION_SEC[platform];
    if (video.duration_sec > maxDuration) {
      const minutes = Math.floor(video.duration_sec / 60);
      const seconds = video.duration_sec % 60;
      const maxMinutes = Math.floor(maxDuration / 60);
      issues.push(`Video duration ${minutes}:${seconds.toString().padStart(2, '0')} exceeds maximum ${maxMinutes}:00 for ${platform}`);
    }
  }
  
  // Size check (rough estimate based on bitrate)
  const estimatedBitrate = (video.size_bytes * 8) / (video.duration_sec || 1) / 1000; // kbps
  if (estimatedBitrate > requirements.maxBitrate) {
    issues.push(`Estimated bitrate ${estimatedBitrate.toFixed(0)} kbps exceeds maximum ${requirements.maxBitrate} kbps for ${platform}`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}


