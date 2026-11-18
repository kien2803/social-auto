import { Hono } from 'hono';
import type { Context } from 'hono';
import { VideosRepo } from '../repos/videos';
import { ScheduledPostsRepo } from '../repos/scheduledPosts';
import { bearerUserId } from '../lib/auth';
import { sniffVideoFormat } from '../lib/fileSniff';
import { hashStream } from '../lib/sha256';
import type { VideoRow } from '../repos/types';
import type { Env } from '../env';

export const videoRoutes = new Hono<{ Bindings: Env }>();

const ACCEPTED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB — R2 single-put ceiling is 5 GB
const MAX_THUMB_SIZE = 5 * 1024 * 1024;

/** Wire shape — file_path/thumbnail_path are R2 keys and never leave the
 *  server; the client sees the original basename only. */
function toWire(v: VideoRow) {
  return {
    id: v.id,
    sha256: v.sha256,
    size_bytes: v.size_bytes,
    duration_sec: v.duration_sec,
    mime: v.mime,
    filename: v.file_path.split('/').pop() ?? v.file_path,
    has_thumbnail: !!v.thumbnail_path,
    created_at: v.created_at,
  };
}

function sanitizeFilename(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? 'video.mp4')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>"|?*]/g, '')
    .trim();
  return (base || 'video.mp4').slice(0, 150);
}

async function ownedVideo(c: Context<{ Bindings: Env }>, id: string) {
  const userId = await bearerUserId(c);
  if (!userId) return { error: c.json({ error: 'Unauthorized' }, 401) } as const;
  const video = await new VideosRepo(c.env.DB).findById(id);
  if (!video) return { error: c.json({ error: 'video_not_found' }, 404) } as const;
  if (video.user_id !== userId) return { error: c.json({ error: 'access_denied' }, 403) } as const;
  return { userId, video } as const;
}

/**
 * Upload: raw streamed body → tee → R2 + sha256 in one pass.
 *
 * Why raw instead of multipart: isolate memory caps at ~128 MB, and
 * formData() buffers whole files there. Streaming request.body into R2
 * keeps a 2 GB upload inside a few MB of isolate memory.
 *
 * Client contract: POST /videos?filename=<name>&duration_sec=<s>
 *   Content-Type: video/mp4 | video/quicktime | video/webm
 *   body: the file's raw bytes (XHR upload progress still works).
 */
videoRoutes.post('/videos', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const contentType = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (contentType.startsWith('multipart/')) {
    return c.json({ error: 'invalid_format', message: 'Send the raw file body — this endpoint no longer accepts multipart' }, 415);
  }
  if (!ACCEPTED_MIME.has(contentType)) {
    return c.json({ error: `unsupported_type: ${contentType || 'missing'}`, message: 'MP4, MOV and WebM only', code: 'UNSUPPORTED_TYPE' }, 415);
  }

  const filename = sanitizeFilename(c.req.query('filename') ?? 'video.mp4');
  const durationSec = (() => {
    const n = Number(c.req.query('duration_sec'));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  })();
  const declaredLen = Number(c.req.header('content-length') ?? 0) || 0;

  const videos = new VideosRepo(c.env.DB);
  const quotaBytes = Number(c.env.STORAGE_QUOTA_GB) * 1024 ** 3;
  const usedBytes = await videos.storageUsedBytes(userId);
  if (declaredLen && usedBytes + declaredLen > quotaBytes) {
    return c.json({ error: 'storage_quota_exceeded', message: `Storage quota ${c.env.STORAGE_QUOTA_GB}GB would be exceeded`, code: 'INSUFFICIENT_STORAGE' }, 507);
  }
  if (declaredLen > MAX_VIDEO_SIZE) {
    return c.json({ error: 'file_too_large', message: `Maximum size is ${(MAX_VIDEO_SIZE / 1024 ** 3).toFixed(1)}GB`, code: 'FILE_TOO_LARGE' }, 413);
  }
  if (!c.req.raw.body) return c.json({ error: 'no_file', code: 'NO_FILE' }, 400);

  const videoId = crypto.randomUUID();
  const key = `videos/${userId}/${videoId}/${filename}`;

  // Tee: one branch streams into R2, the other is pumped through the
  // incremental hasher — both consumed concurrently or the tee's internal
  // queue would buffer the whole file.
  const [toR2, toHash] = c.req.raw.body.tee();
  let stored = false;
  try {
    const [, hashed] = await Promise.all([
      c.env.STORAGE.put(key, toR2).then((r) => { stored = true; return r; }),
      hashStream(toHash),
    ]);
    const { sha256, size, head } = hashed;

    const cleanup = async () => { await c.env.STORAGE.delete(key).catch(() => {}); };
    if (size === 0) { await cleanup(); return c.json({ error: 'empty_upload' }, 400); }
    if (size > MAX_VIDEO_SIZE) { await cleanup(); return c.json({ error: 'file_too_large', code: 'FILE_TOO_LARGE' }, 413); }
    if (!sniffVideoFormat(head)) {
      await cleanup();
      return c.json({ error: 'unsupported_type: not a video file', code: 'UNSUPPORTED_TYPE' }, 415);
    }
    if (usedBytes + size > quotaBytes) {
      await cleanup();
      return c.json({ error: 'storage_quota_exceeded', code: 'INSUFFICIENT_STORAGE' }, 507);
    }

    // Dedupe: same user + same content → point the new row at the existing
    // object instead of storing the bytes twice.
    const existing = await videos.findBySha256(userId, sha256);
    if (existing) {
      await cleanup();
      return c.json({ video: toWire(existing), deduped: true }, 200);
    }

    const row = await videos.insert({
      id: videoId,
      user_id: userId,
      file_path: key,
      sha256,
      size_bytes: size,
      duration_sec: durationSec,
      mime: contentType,
    });
    return c.json({ video: toWire(row), deduped: false }, 201);
  } catch (err) {
    if (stored) await c.env.STORAGE.delete(key).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `upload_failed: ${msg}`, code: 'INTERNAL_ERROR' }, 500);
  }
});

/** Client-extracted thumbnail (jpeg from <canvas>) — ffmpeg doesn't exist
 *  on Workers, so the browser renders the frame for us. */
videoRoutes.put('/videos/:id/thumbnail', async (c) => {
  const r = await ownedVideo(c, c.req.param('id'));
  if ('error' in r) return r.error;
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (contentType !== 'image/jpeg') return c.json({ error: 'thumbnail must be image/jpeg' }, 415);
  const declared = Number(c.req.header('content-length') ?? 0) || 0;
  if (declared > MAX_THUMB_SIZE) return c.json({ error: 'thumbnail_too_large' }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_THUMB_SIZE) return c.json({ error: 'thumbnail_too_large' }, 413);
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return c.json({ error: 'thumbnail must be a JPEG' }, 415);
  }
  const thumbKey = `videos/${r.video.user_id}/${r.video.id}/_thumb.jpg`;
  await c.env.STORAGE.put(thumbKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await new VideosRepo(c.env.DB).setThumbnail(r.video.id, thumbKey);
  return c.json({ ok: true });
});

videoRoutes.get('/videos', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await new VideosRepo(c.env.DB).list(userId, 200);
  return c.json({ videos: rows.map(toWire) });
});

videoRoutes.get('/videos/:id', async (c) => {
  const r = await ownedVideo(c, c.req.param('id'));
  if ('error' in r) return r.error;
  return c.json(toWire(r.video));
});

videoRoutes.get('/videos/:id/thumbnail', async (c) => {
  const r = await ownedVideo(c, c.req.param('id'));
  if ('error' in r) return r.error;
  if (!r.video.thumbnail_path) return c.json({ error: 'no_thumbnail' }, 404);
  const obj = await c.env.STORAGE.get(r.video.thumbnail_path);
  if (!obj) return c.json({ error: 'no_thumbnail' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' },
  });
});

/** Range-aware stream for <video> preview — mirrors the legacy route. */
videoRoutes.get('/videos/:id/stream', async (c) => {
  const r = await ownedVideo(c, c.req.param('id'));
  if ('error' in r) return r.error;
  const size = r.video.size_bytes;
  const range = c.req.header('range');
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const obj = await c.env.STORAGE.get(r.video.file_path, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return c.json({ error: 'object_missing' }, 404);
    return new Response(obj.body, {
      status: 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        'content-type': r.video.mime,
      },
    });
  }
  const obj = await c.env.STORAGE.get(r.video.file_path);
  if (!obj) return c.json({ error: 'object_missing' }, 404);
  return new Response(obj.body, {
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(size),
      'content-type': r.video.mime,
    },
  });
});

videoRoutes.delete('/videos/:id', async (c) => {
  const r = await ownedVideo(c, c.req.param('id'));
  if ('error' in r) return r.error;
  // scheduled_posts.video_id has no cascade — refuse cleanly like the
  // legacy route instead of surfacing an FK error.
  const referencing = await new ScheduledPostsRepo(c.env.DB).countByVideoId(r.video.id);
  if (referencing > 0) {
    return c.json({ error: 'video_has_scheduled_posts', message: `${referencing} scheduled post(s) still reference this video — cancel them first` }, 409);
  }
  const videos = new VideosRepo(c.env.DB);
  // The object is shared when another row deduped onto the same sha256 —
  // only delete storage when this row is the last reference.
  const shared = (await videos.countBySha256(r.video.sha256)) > 1;
  await videos.delete(r.video.id);
  if (!shared) {
    await c.env.STORAGE.delete(r.video.file_path).catch(() => {});
    if (r.video.thumbnail_path) await c.env.STORAGE.delete(r.video.thumbnail_path).catch(() => {});
  }
  return c.json({ success: true, message: 'Video deleted' });
});
