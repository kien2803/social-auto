import { createReadStream, statSync } from 'node:fs';
import type {
  Publisher,
  PublisherInput,
  PublisherUploadResult,
  PublisherValidation,
  Platform,
  UploadMeta,
  PublisherVideo,
} from '@social-auto/shared';
import { PLATFORM_CAPTION_LIMITS, PLATFORM_MAX_DURATION_SEC } from '@social-auto/shared';

const TIKTOK_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

/**
 * Size of a single chunk when uploading to TikTok via the FILE_UPLOAD
 * transfer method. 10 MB matches what TikTok's docs use in their example.
 */
const CHUNK_SIZE = 10 * 1024 * 1024;

export interface TiktokPublisherConfig {
  useMock: boolean;
  clientKey: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

export class TiktokPublisher implements Publisher {
  readonly platform: Platform = 'tiktok';
  private cfg: TiktokPublisherConfig;

  constructor(cfg: TiktokPublisherConfig) {
    this.cfg = cfg;
  }

  validate(meta: UploadMeta, video: PublisherVideo): PublisherValidation {
    const errors: string[] = [];
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.tiktok) {
      errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.tiktok} chars`);
    }
    if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC.tiktok) {
      errors.push(`video exceeds ${PLATFORM_MAX_DURATION_SEC.tiktok}s TikTok limit`);
    }
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublisherInput): Promise<PublisherUploadResult> {
    if (this.cfg.useMock || !this.cfg.clientKey) {
      return stubUpload(input);
    }
    return realUpload(this.cfg, input);
  }
}

async function stubUpload(input: PublisherInput): Promise<PublisherUploadResult> {
  if (input.access_token && !input.access_token.startsWith('mock-tt-')) {
    throw new Error('tiktok: invalid access token (stub)');
  }
  const id = `mock-tt-${Date.now()}`;
  return { external_id: id, url: `https://tiktok.com/@me/video/${id}` };
}

interface TiktokInitResponse {
  data?: {
    publish_id?: string;
    upload_url?: string;
  };
  error?: { code: string; message: string };
}

interface TiktokStatusResponse {
  data?: {
    status?: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
    fail_reason?: string;
    publicaly_available_post_id?: string[];
  };
  error?: { code: string; message: string };
}

async function realUpload(
  cfg: TiktokPublisherConfig,
  input: PublisherInput,
): Promise<PublisherUploadResult> {
  const f = cfg.fetchImpl ?? fetch;

  // Verify the file exists and read its size up front — we need the
  // total_byte count to compute chunking.
  const stat = statSync(input.video.file_path);
  if (stat.size !== input.video.size_bytes) {
    throw new Error(
      `tiktok: size_mismatch db=${input.video.size_bytes} disk=${stat.size}`,
    );
  }
  const totalBytes = stat.size;
  const chunkSize = Math.min(CHUNK_SIZE, totalBytes);
  const totalChunkCount = Math.max(1, Math.ceil(totalBytes / chunkSize));

  // Step 1: initialize the post. POST /v2/post/publish/video/init/.
  const initRes = await f(TIKTOK_INIT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.access_token}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: input.meta.caption,
        // Default to SELF_ONLY for unverified apps; the user can re-share.
        // Production apps after audit can use PUBLIC_TO_EVERYONE.
        privacy_level: 'SELF_ONLY',
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: totalBytes,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });
  const initJson = (await initRes.json()) as TiktokInitResponse;
  if (initJson.error && initJson.error.code !== 'ok') {
    throw new Error(
      `tiktok: init failed: ${initJson.error.code} ${initJson.error.message}`,
    );
  }
  const publishId = initJson.data?.publish_id;
  const uploadUrl = initJson.data?.upload_url;
  if (!publishId || !uploadUrl) {
    throw new Error('tiktok: init response missing publish_id or upload_url');
  }

  // Step 2: PUT the video bytes to upload_url. Each PUT covers a
  // [first, last] byte range. For files <= CHUNK_SIZE this is one PUT.
  const mime = input.video.mime || 'video/mp4';
  for (let i = 0; i < totalChunkCount; i += 1) {
    const first = i * chunkSize;
    const last = Math.min(first + chunkSize, totalBytes) - 1;
    await f(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': mime,
        'content-length': String(last - first + 1),
        'content-range': `bytes ${first}-${last}/${totalBytes}`,
      },
      body: createReadStream(input.video.file_path, { start: first, end: last }),
    });
  }

  // Step 3: poll status until PUBLISH_COMPLETE. The publish_id is the
  // final identifier we hand back even if TikTok is still processing —
  // their API is async.
  const finalId = await pollUntilDone(f, input.access_token, publishId);
  return { external_id: finalId, url: `https://tiktok.com/@me/video/${finalId}` };
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function pollUntilDone(
  f: typeof fetch,
  accessToken: string,
  publishId: string,
): Promise<string> {
  const maxAttempts = 30; // 30 × 2s = 60s
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(2000);
    const res = await f(TIKTOK_STATUS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json = (await res.json()) as TiktokStatusResponse;
    const status = json.data?.status;
    if (status === 'PUBLISH_COMPLETE') {
      const ids = json.data?.publicaly_available_post_id;
      return ids?.[0] ?? publishId;
    }
    if (status === 'FAILED') {
      throw new Error(
        `tiktok: publish failed: ${json.data?.fail_reason ?? 'unknown'}`,
      );
    }
  }
  // Timed out still processing — return the publish_id so the row is at
  // least marked published, and a future reconciliation can verify.
  return publishId;
}
