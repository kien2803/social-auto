import type { Platform } from '../repos/types';

/**
 * Media constraints surfaced as WARNINGS in preflight — the authoritative
 * blocking rules stay in each publisher's validate(); these flag likely
 * rejections/recompression the validators don't cover. Ported from the
 * shared package's PLATFORM_VIDEO_REQUIREMENTS (codec/bitrate/frame-rate
 * entries dropped — unverifiable from stored metadata, never invented).
 */
export const PLATFORM_ASPECTS: Record<Platform, string[]> = {
  youtube: ['16:9', '9:16', '1:1'],
  tiktok: ['9:16', '1:1'],
  instagram: ['1:1', '4:5', '9:16'],
  facebook: ['16:9', '1:1', '4:5'],
};

/** Max frame size (width x height) per platform — above this the platform
 *  recompresses or rejects. */
export const PLATFORM_MAX_RESOLUTION: Record<Platform, [number, number]> = {
  youtube: [3840, 2160],
  tiktok: [1080, 1920],
  instagram: [1080, 1920],
  facebook: [1920, 1080],
};

/** Estimated bitrate ceiling (kbps) — size*8/duration. */
export const PLATFORM_MAX_BITRATE_KBPS: Record<Platform, number> = {
  youtube: 50_000,
  tiktok: 12_000,
  instagram: 15_000,
  facebook: 8_000,
};

/** Server-side upload ceiling — mirrors MAX_VIDEO_SIZE in routes/videos. */
export const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;
