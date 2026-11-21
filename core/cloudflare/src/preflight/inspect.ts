import type { VideoRow } from '../repos/types';
import { MAX_VIDEO_SIZE } from './limits';
import type { PreflightIssue, VideoInspection } from './types';

const MIME_TO_FORMAT: Record<string, VideoInspection['format']> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectOf(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/**
 * Inspect stored video metadata — everything the worker can verify without
 * decoding the file (Workers has no ffprobe; dims are client-extracted at
 * upload). `objectExists` comes from a STORAGE.head probe; null means the
 * probe itself failed and the check was skipped rather than failed.
 */
export function inspectVideo(video: VideoRow, objectExists: boolean | null): VideoInspection {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  const format = MIME_TO_FORMAT[video.mime] ?? null;
  if (!format) {
    errors.push({
      code: 'unsupported_format',
      message: `"${video.mime}" is not a supported container — upload MP4, MOV or WebM.`,
      fix: 'Re-export the video as MP4 (H.264) and upload it again.',
    });
  }

  if (video.size_bytes <= 0) {
    errors.push({ code: 'empty_file', message: 'The stored file is 0 bytes.', fix: 'Re-upload the video.' });
  } else if (video.size_bytes > MAX_VIDEO_SIZE) {
    errors.push({
      code: 'file_too_large',
      message: `File is ${(video.size_bytes / 1024 ** 3).toFixed(1)} GB — the ${(MAX_VIDEO_SIZE / 1024 ** 3).toFixed(0)} GB ceiling applies to every platform.`,
      fix: 'Compress the video (lower resolution or bitrate) and re-upload.',
    });
  }

  if (objectExists === false) {
    errors.push({
      code: 'file_missing',
      message: 'The video bytes are missing from storage.',
      fix: 'Re-upload the video — scheduled posts referencing it cannot publish.',
    });
  }

  if (video.duration_sec === null || video.duration_sec <= 0) {
    warnings.push({
      code: 'duration_unknown',
      message: 'Duration was not detected — some platforms require it.',
      fix: 'Re-upload the video so the browser can read its metadata.',
    });
  }

  if (!video.width || !video.height) {
    warnings.push({
      code: 'dimensions_unknown',
      message: 'Resolution and aspect ratio unknown (uploaded before dimension tracking).',
      fix: 'Re-upload the video to enable per-platform aspect checks.',
    });
  }

  return {
    mime: video.mime,
    format,
    size_bytes: video.size_bytes,
    duration_sec: video.duration_sec,
    width: video.width,
    height: video.height,
    aspect: video.width && video.height ? aspectOf(video.width, video.height) : null,
    errors,
    warnings,
  };
}
