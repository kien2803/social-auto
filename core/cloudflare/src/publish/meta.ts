import type { Env } from '../env';
import type { Publisher, PublishInput, PublishMeta, PublishResult, PublishVideo } from './types';
import { PublishError, r2Range, PLATFORM_CAPTION_LIMITS, PLATFORM_MAX_DURATION_SEC } from './types';

const GRAPH_BASE = 'https://graph.facebook.com';
const RUPLOAD_BASE = 'https://rupload.facebook.com/graph-video';
const DEFAULT_API_VERSION = 'v24.0';
const FB_CHUNK = 8 * 1024 * 1024;
const POLL_MAX_MS = 50_000;

function apiVersion(env: Env): string {
  return env.META_API_VERSION || DEFAULT_API_VERSION;
}

interface FbState {
  session_id?: string;
  video_id?: string;
  offset?: number;
  finished?: boolean;
}

interface FbStartResponse {
  upload_session_id?: string;
  video_id?: string;
  start_offset?: string;
  end_offset?: string;
  error?: { code?: number; message?: string };
}

/**
 * Facebook Page video upload — resumable protocol:
 *   POST /{page}/videos?upload_phase=start → chunked PUTs to rupload →
 *   POST finish.
 *
 * Chunked instead of the legacy single-shot multipart: the whole file
 * never sits in isolate memory. Session state is persisted so a retry
 * resumes at the last acknowledged offset; if the finish call's response
 * was lost, the saved video_id resolves the post without a duplicate.
 */
export class FacebookPublisher implements Publisher {
  readonly platform = 'facebook' as const;

  validate(meta: PublishMeta, video: PublishVideo) {
    const errors: string[] = [];
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.facebook) errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.facebook} chars`);
    if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC.facebook) errors.push(`video exceeds ${PLATFORM_MAX_DURATION_SEC.facebook}s FB limit`);
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublishInput): Promise<PublishResult> {
    const { env, access_token, video, meta, state, saveState } = input;
    const st = (state ?? {}) as FbState;
    const base = `${GRAPH_BASE}/${apiVersion(env)}`;
    const pageId = meta.external_id ?? '';
    if (!pageId) throw new Error('facebook: missing meta.external_id (Page id)');
    const size = video.size_bytes;

    if (st.finished && st.video_id) {
      // The finish response was lost — check whether the video exists
      // before even thinking about re-uploading.
      const check = await fetch(`${base}/${st.video_id}?fields=id&access_token=${encodeURIComponent(access_token)}`);
      if (check.ok) {
        return { external_id: st.video_id, url: `https://facebook.com/watch/?v=${st.video_id}` };
      }
    }

    let sessionId = typeof st.session_id === 'string' ? st.session_id : null;
    let videoId = typeof st.video_id === 'string' ? st.video_id : null;
    let offset = typeof st.offset === 'number' ? st.offset : 0;

    if (!sessionId || !videoId) {
      const startRes = await fetch(`${base}/${pageId}/videos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upload_phase: 'start', file_size: size, access_token }),
      });
      const startJson = (await startRes.json()) as FbStartResponse;
      if (startJson.error || !startJson.upload_session_id) {
        throw new Error(`facebook: upload start: ${startJson.error?.message ?? 'no session id'}`);
      }
      sessionId = startJson.upload_session_id;
      videoId = startJson.video_id ?? null;
      offset = Number(startJson.start_offset ?? 0);
      await saveState({ session_id: sessionId, video_id: videoId, offset });
    }

    // Transfer chunks — the API echoes the next expected offset range.
    while (offset < size) {
      const end = Math.min(offset + FB_CHUNK, size) - 1;
      const chunk = await r2Range(env, video.key, offset, end - offset + 1);
      const res = await fetch(`${RUPLOAD_BASE}/${apiVersion(env)}/${sessionId}`, {
        method: 'POST',
        headers: {
          authorization: `OAuth ${access_token}`,
          offset: String(offset),
          file_size: String(size),
          'content-type': 'application/octet-stream',
        },
        body: chunk,
      });
      const json = (await res.json().catch(() => ({}))) as { start_offset?: string; end_offset?: string; error?: { message?: string } };
      if (!res.ok || json.error) {
        throw new PublishError(
          `facebook: chunk upload failed ${res.status} ${json.error?.message ?? ''}`.trim(),
          { session_id: sessionId, video_id: videoId, offset },
        );
      }
      offset = Number(json.end_offset ?? end + 1);
      await saveState({ session_id: sessionId, video_id: videoId, offset });
    }

    const finishRes = await fetch(`${base}/${pageId}/videos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'finish',
        upload_session_id: sessionId,
        title: meta.title,
        description: meta.caption,
        access_token,
      }),
    });
    const finishJson = (await finishRes.json()) as { success?: boolean; error?: { message?: string } };
    if (!finishRes.ok || finishJson.error) {
      // A prior attempt's finish may have secretly succeeded (we crashed
      // before saveState) — probe the video before declaring failure.
      if (videoId) {
        const check = await fetch(`${base}/${videoId}?fields=id&access_token=${encodeURIComponent(access_token)}`);
        if (check.ok) {
          await saveState({ session_id: sessionId, video_id: videoId, offset, finished: true });
          return { external_id: videoId, url: `https://facebook.com/watch/?v=${videoId}` };
        }
      }
      throw new PublishError(
        `facebook: upload finish: ${finishJson.error?.message ?? `http ${finishRes.status}`}`,
        { session_id: sessionId, video_id: videoId, offset },
      );
    }
    await saveState({ session_id: sessionId, video_id: videoId, offset, finished: true });
    return {
      external_id: videoId ?? sessionId,
      url: videoId ? `https://facebook.com/watch/?v=${videoId}` : undefined,
    };
  }
}

// ─── Instagram ──────────────────────────────────────────────────────────

interface IgState {
  container_id?: string;
  media_id?: string;
}

interface IgContainerResponse {
  id?: string;
  error?: { code?: number; message?: string };
}

interface IgStatusResponse {
  status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  error?: { code?: number; message?: string };
}

interface IgPublishResponse {
  id?: string;
  error?: { code?: number; message?: string };
}

/**
 * Instagram Reels via the Graph API container flow:
 *   POST /{ig-user}/media (video_url pull) → poll status → media_publish.
 *
 * IG can't receive bytes — it pulls meta.video_url, which is the signed
 * /media/:id URL the consumer mints (short-lived HMAC, no auth — Meta's
 * crawler can't send one).
 *
 * Dedupe: container_id is persisted; a retry resumes at the status poll.
 * A PUBLISHED container resolves to its media id instead of republishing.
 */
export class InstagramPublisher implements Publisher {
  readonly platform = 'instagram' as const;

  validate(meta: PublishMeta, video: PublishVideo) {
    const errors: string[] = [];
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.instagram) errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.instagram} chars`);
    if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC.instagram) errors.push(`video exceeds ${PLATFORM_MAX_DURATION_SEC.instagram}s IG Reels limit`);
    if (!meta.video_url) errors.push('missing video_url (public URL required)');
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublishInput): Promise<PublishResult> {
    const { env, access_token, meta, state, saveState } = input;
    const st = (state ?? {}) as IgState;
    const base = `${GRAPH_BASE}/${apiVersion(env)}`;
    const userId = meta.external_id ?? '';
    if (!userId) throw new Error('instagram: missing meta.external_id (IG business account id)');
    if (!meta.video_url) throw new Error('instagram: missing meta.video_url');
    const started = Date.now();

    if (st.media_id) {
      return { external_id: st.media_id, url: `https://instagram.com/reel/${st.media_id}` };
    }

    let containerId = typeof st.container_id === 'string' ? st.container_id : null;
    if (!containerId) {
      const createRes = await fetch(`${base}/${userId}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: meta.video_url,
          caption: meta.caption,
          access_token,
        }),
      });
      const createJson = (await createRes.json()) as IgContainerResponse;
      if (createJson.error || !createJson.id) {
        throw new Error(`instagram: create container: ${createJson.error?.message ?? 'no id returned'}`);
      }
      containerId = createJson.id;
      await saveState({ container_id: containerId });
    }

    // Poll the container until IG finishes pulling + processing the video.
    const deadline = started + POLL_MAX_MS;
    for (;;) {
      await sleep(2000);
      const res = await fetch(
        `${base}/${containerId}?fields=status_code&access_token=${encodeURIComponent(access_token)}`,
      );
      const json = (await res.json()) as IgStatusResponse;
      if (json.status_code === 'PUBLISHED') {
        // A prior media_publish secretly succeeded — claim it.
        return { external_id: containerId, url: `https://instagram.com/reel/${containerId}` };
      }
      if (json.status_code === 'FINISHED') break;
      if (json.status_code === 'ERROR' || json.status_code === 'EXPIRED') {
        throw new PublishError(`instagram: container status=${json.status_code} ${json.error?.message ?? ''}`.trim(), {});
      }
      if (Date.now() >= deadline) {
        throw new PublishError('instagram: container did not reach FINISHED in time', { container_id: containerId });
      }
    }

    const pubRes = await fetch(`${base}/${userId}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token }),
    });
    const pubJson = (await pubRes.json()) as IgPublishResponse;
    if (pubJson.error || !pubJson.id) {
      throw new PublishError(`instagram: publish: ${pubJson.error?.message ?? 'no id returned'}`, { container_id: containerId });
    }
    await saveState({ container_id: containerId, media_id: pubJson.id });
    return { external_id: pubJson.id, url: `https://instagram.com/reel/${pubJson.id}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
