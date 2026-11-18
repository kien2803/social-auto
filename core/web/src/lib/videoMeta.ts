import { api, type VideoWire } from './api.js';

export interface VideoMeta {
  duration_sec: number | null;
  thumbnail: Blob | null;
}

/**
 * Extract duration + a poster frame in the browser. The Cloudflare worker
 * has no ffmpeg, so the client renders a frame via <video> + <canvas> and
 * uploads it as the thumbnail after the video lands.
 */
export async function extractVideoMeta(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;

    const timeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('video_meta_timeout')), ms))]);

    const loaded = new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('video_load_failed'));
    });
    await timeout(loaded, 10_000);

    const durationSec = Number.isFinite(video.duration) ? video.duration : null;

    // Seek ~10% in (or 1s) for a representative frame, then draw it.
    const seekTo = durationSec ? Math.min(Math.max(durationSec * 0.1, 0.5), 10) : 0.5;
    const seeked = new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = seekTo;
    });
    await timeout(seeked, 5_000).catch(() => {});

    let thumbnail: Blob | null = null;
    if (video.videoWidth > 0) {
      const maxW = 640;
      const scale = Math.min(1, maxW / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbnail = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.75));
    }
    return { duration_sec: durationSec ? Math.round(durationSec) : null, thumbnail };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Full upload flow: extract meta → stream file → PUT thumbnail.
 * Returns the created (or deduped) video row.
 */
export async function uploadVideoAsset(
  file: File,
  onProgress?: (bytes: number) => void,
): Promise<{ video: VideoWire; deduped: boolean }> {
  const meta = await extractVideoMeta(file).catch(() => ({ duration_sec: null, thumbnail: null }));
  const res = await api.uploadVideo(file, onProgress, { duration_sec: meta.duration_sec });
  if (meta.thumbnail && !res.deduped) {
    await api.putVideoThumbnail(res.video.id, meta.thumbnail).catch(() => {});
  }
  return res;
}
