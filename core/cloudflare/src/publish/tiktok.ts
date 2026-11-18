import type { Publisher, PublishInput, PublishMeta, PublishResult, PublishVideo } from './types';
import { PublishError, r2Range, PLATFORM_CAPTION_LIMITS, PLATFORM_MAX_DURATION_SEC } from './types';

const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const CHUNK = 10 * 1024 * 1024; // 10 MB — TikTok docs' example chunk size
const POLL_MAX_MS = 50_000;

interface TtState {
  publish_id?: string;
  /** Set only after every chunk landed — an upload session TikTok can publish. */
  uploaded?: boolean;
}

interface TtInitResponse {
  data?: { publish_id?: string; upload_url?: string };
  error?: { code: string; message: string };
}

interface TtStatusResponse {
  data?: {
    status?: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
    fail_reason?: string;
    publicaly_available_post_id?: string[];
  };
  error?: { code: string; message: string };
}

/**
 * TikTok Content Posting API — FILE_UPLOAD flow:
 *   init → chunked PUTs → status poll.
 *
 * Dedupe: TikTok upload sessions can't be resumed — a chunk failure means
 * re-init. publish_id alone doesn't prove bytes landed, so state carries
 * an `uploaded` flag set only after the final chunk is acknowledged. A
 * retry holding publish_id WITHOUT the flag checks the session's status
 * once (it may have secretly completed) before re-initing.
 */
export class TiktokPublisher implements Publisher {
  readonly platform = 'tiktok' as const;

  validate(meta: PublishMeta, video: PublishVideo) {
    const errors: string[] = [];
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.tiktok) errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.tiktok} chars`);
    if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC.tiktok) errors.push(`video exceeds ${PLATFORM_MAX_DURATION_SEC.tiktok}s TikTok limit`);
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublishInput): Promise<PublishResult> {
    const { env, access_token, video, meta, state, saveState } = input;
    const st = (state ?? {}) as TtState;
    const size = video.size_bytes;
    const mime = video.mime || 'video/mp4';
    const started = Date.now();
    let publishId = typeof st.publish_id === 'string' ? st.publish_id : null;

    if (publishId && st.uploaded !== true) {
      // Previous attempt died after init but before chunk completion (or
      // lost the last response). The orphan session may still have gone
      // through — check once, then treat it as dead and re-init.
      const done = await checkStatus(access_token, publishId);
      if (done) return done;
      publishId = null;
    }

    if (!publishId) {
      const chunkSize = Math.min(CHUNK, size);
      const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
      const initRes = await fetch(INIT_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access_token}`,
          'content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            // Tags ride inline as hashtags — TikTok has no tags array.
            title: tiktokTitle(meta),
            // Unverified apps can only post SELF_ONLY; upgraded apps flip
            // this to PUBLIC_TO_EVERYONE after TikTok audit.
            privacy_level: 'SELF_ONLY',
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: size,
            chunk_size: chunkSize,
            total_chunk_count: totalChunks,
          },
        }),
      });
      const initJson = (await initRes.json().catch(() => ({}))) as TtInitResponse;
      if (!initRes.ok || (initJson.error && initJson.error.code !== 'ok')) {
        throw new Error(`tiktok: init failed ${initRes.status}: ${initJson.error?.code ?? ''} ${initJson.error?.message ?? ''}`.trim());
      }
      publishId = initJson.data?.publish_id ?? null;
      const uploadUrl = initJson.data?.upload_url ?? null;
      if (!publishId || !uploadUrl) throw new Error('tiktok: init missing publish_id or upload_url');
      await saveState({ publish_id: publishId });

      for (let i = 0; i < totalChunks; i++) {
        const first = i * chunkSize;
        const last = Math.min(first + chunkSize, size) - 1;
        const chunk = await r2Range(env, video.key, first, last - first + 1);
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'content-type': mime,
            'content-length': String(chunk.length),
            'content-range': `bytes ${first}-${last}/${size}`,
          },
          body: chunk,
        });
        if (!res.ok && res.status !== 201) {
          const body = await res.text().catch(() => '');
          // Dead session — TikTok chunks can't resume, retry re-inits.
          throw new PublishError(`tiktok: chunk upload failed ${res.status} ${body.slice(0, 300)}`, {});
        }
      }
      // All bytes acknowledged — the session is now publishable; a retry
      // from here only needs the status poll.
      await saveState({ publish_id: publishId, uploaded: true });
    }

    // Poll until PUBLISH_COMPLETE — bounded so the queue consumer isn't
    // parked forever; the publish_id is a valid id either way.
    const deadline = started + POLL_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(2000);
      const res = await fetch(STATUS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access_token}`,
          'content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const json = (await res.json()) as TtStatusResponse;
      const status = json.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        const ids = json.data?.publicaly_available_post_id;
        const id = ids?.[0] ?? publishId;
        return { external_id: id, url: `https://tiktok.com/@me/video/${id}` };
      }
      if (status === 'FAILED') {
        throw new PublishError(`tiktok: publish failed: ${json.data?.fail_reason ?? 'unknown'}`, {});
      }
    }
    return { external_id: publishId, url: `https://tiktok.com/@me/video/${publishId}` };
  }
}

/** Caption + tags-as-hashtags, deduped — TikTok's title field is the caption. */
function tiktokTitle(meta: { caption: string; tags?: string[] }): string {
  const missing = (meta.tags ?? []).filter((t) => !meta.caption.includes(`#${t}`)).map((t) => `#${t}`);
  const title = missing.length ? `${meta.caption} ${missing.join(' ')}` : meta.caption;
  return title.slice(0, 2200);
}

/** One-shot status check for a session left over from a crashed attempt. */
async function checkStatus(access_token: string, publishId: string): Promise<PublishResult | null> {
  const res = await fetch(STATUS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const json = (await res.json().catch(() => ({}))) as TtStatusResponse;
  if (json.data?.status === 'PUBLISH_COMPLETE') {
    const id = json.data.publicaly_available_post_id?.[0] ?? publishId;
    return { external_id: id, url: `https://tiktok.com/@me/video/${id}` };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
