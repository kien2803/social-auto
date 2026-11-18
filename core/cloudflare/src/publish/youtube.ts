import type { Publisher, PublishInput, PublishMeta, PublishResult, PublishVideo } from './types';
import { PublishError, r2Range, PLATFORM_CAPTION_LIMITS, PLATFORM_TITLE_LIMITS } from './types';

const INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
/** 8 MB — must be a multiple of 256 KB per YouTube resumable rules. */
const CHUNK = 8 * 1024 * 1024;

interface YtState {
  upload_url?: string;
}

/**
 * YouTube Data API v3 resumable upload, ported to fetch + R2 range reads.
 *
 * Dedupe: the upload-session URL is persisted in platform_state. A retry
 * probes the session (PUT with Content-Range "bytes * / size"): if the
 * previous attempt's final chunk actually landed, YouTube returns the
 * finished video resource —
 * we mark published instead of re-uploading into a duplicate.
 */
export class YoutubePublisher implements Publisher {
  readonly platform = 'youtube' as const;

  validate(meta: PublishMeta, video: PublishVideo) {
    const errors: string[] = [];
    if (!meta.title.trim()) errors.push('title required');
    if (meta.title.length > PLATFORM_TITLE_LIMITS.youtube) errors.push(`title exceeds ${PLATFORM_TITLE_LIMITS.youtube} chars`);
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.youtube) errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.youtube} chars`);
    if (!video.duration_sec || video.duration_sec <= 0) errors.push('duration unknown');
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublishInput): Promise<PublishResult> {
    const { env, access_token, video, meta, state, saveState } = input;
    const st = (state ?? {}) as YtState;
    const size = video.size_bytes;
    let uploadUrl = typeof st.upload_url === 'string' ? st.upload_url : null;
    let offset = 0;

    if (uploadUrl) {
      // Resume probe — ask the session how much it already has.
      const probe = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-length': '0', 'content-range': `bytes */${size}` },
      });
      if (probe.status === 200 || probe.status === 201) {
        // Previous attempt actually finished — the response just never
        // reached us. Claim the win instead of duplicating the upload.
        const data = (await probe.json().catch(() => ({}))) as { id?: string };
        if (data.id) return { external_id: data.id, url: `https://youtube.com/watch?v=${data.id}` };
      }
      if (probe.status === 308) {
        const range = probe.headers.get('range') ?? ''; // "bytes=0-<last>"
        const last = Number(range.split('-')[1]);
        if (Number.isFinite(last)) offset = last + 1;
      } else {
        // Session expired/dead — fall through to a fresh init.
        uploadUrl = null;
      }
    }

    if (!uploadUrl) {
      const init = await fetch(INIT_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access_token}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': video.mime || 'video/mp4',
          'x-upload-content-length': String(size),
        },
        body: JSON.stringify({
          snippet: { title: meta.title, description: meta.description, tags: meta.tags },
          status: { privacyStatus: meta.visibility },
        }),
      });
      if (!init.ok) {
        const body = await init.text().catch(() => '');
        throw new Error(`youtube: init failed ${init.status} ${body.slice(0, 300)}`);
      }
      uploadUrl = init.headers.get('location');
      if (!uploadUrl) throw new Error('youtube: init missing upload session location');
      await saveState({ upload_url: uploadUrl });
    }

    while (offset < size) {
      const end = Math.min(offset + CHUNK, size) - 1;
      const chunk = await r2Range(env, video.key, offset, end - offset + 1);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-length': String(chunk.length),
          'content-range': `bytes ${offset}-${end}/${size}`,
          'content-type': video.mime || 'video/mp4',
        },
        body: chunk,
      });
      if (res.status === 308) {
        // Resume Incomplete — chunk accepted, send the next one.
        offset = end + 1;
        continue;
      }
      if (res.ok) {
        const data = (await res.json()) as { id?: string };
        if (!data.id) throw new Error('youtube: no video id returned');
        return { external_id: data.id, url: `https://youtube.com/watch?v=${data.id}` };
      }
      const body = await res.text().catch(() => '');
      throw new PublishError(`youtube: chunk upload failed ${res.status} ${body.slice(0, 300)}`, { upload_url: uploadUrl });
    }
    throw new PublishError('youtube: upload ended without a response', { upload_url: uploadUrl });
  }
}
