import { statSync } from 'node:fs';
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

const GRAPH_BASE = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v24.0';

export interface InstagramPublisherConfig {
  useMock: boolean;
  appId: string;
  /** Graph API version. Defaults to v24.0. */
  apiVersion?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

export class InstagramPublisher implements Publisher {
  readonly platform: Platform = 'instagram';
  private cfg: InstagramPublisherConfig;

  constructor(cfg: InstagramPublisherConfig) {
    this.cfg = cfg;
  }

  validate(meta: UploadMeta, video: PublisherVideo): PublisherValidation {
    const errors: string[] = [];
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.instagram) {
      errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.instagram} chars`);
    }
    if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC.instagram) {
      errors.push(`video exceeds ${PLATFORM_MAX_DURATION_SEC.instagram}s IG Reels limit`);
    }
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublisherInput): Promise<PublisherUploadResult> {
    if (this.cfg.useMock || !this.cfg.appId) {
      return stubUpload(input);
    }
    return realUpload(this.cfg, input);
  }
}

async function stubUpload(input: PublisherInput): Promise<PublisherUploadResult> {
  if (input.access_token && !input.access_token.startsWith('mock-ig-')) {
    throw new Error('instagram: invalid access token (stub)');
  }
  const id = `mock-ig-${Date.now()}`;
  return { external_id: id, url: `https://instagram.com/reel/${id}` };
}

interface ContainerResponse {
  id?: string;
  error?: { code?: number; message?: string };
}

interface StatusResponse {
  status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  error?: { code?: number; message?: string };
}

interface PublishResponse {
  id?: string;
  permalink?: string;
  error?: { code?: number; message?: string };
}

async function realUpload(
  cfg: InstagramPublisherConfig,
  input: PublisherInput,
): Promise<PublisherUploadResult> {
  const f = cfg.fetchImpl ?? fetch;
  const apiVersion = cfg.apiVersion ?? DEFAULT_API_VERSION;
  const base = `${GRAPH_BASE}/${apiVersion}`;

  // The IG business account id is passed by the worker through
  // UploadMeta.external_id (the auth callback stored the IG user id
  // there when the user linked their Facebook Page).
  const userId = input.meta.external_id ?? '';
  if (!userId) {
    throw new Error('instagram: missing meta.external_id (IG business account id)');
  }
  // Instagram's Reels container requires a public video_url. The
  // worker is responsible for serving the local file via a public
  // route before calling upload().
  const videoUrl = input.meta.video_url ?? '';
  if (!videoUrl) {
    throw new Error(
      'instagram: real upload requires meta.video_url — worker must serve the file publicly before publishing',
    );
  }

  // Sanity check the on-disk file matches the DB row.
  const stat = statSync(input.video.file_path);
  if (stat.size !== input.video.size_bytes) {
    throw new Error(
      `instagram: size_mismatch db=${input.video.size_bytes} disk=${stat.size}`,
    );
  }

  // Step 1: create the Reels container.
  const createRes = await f(`${base}/${userId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: input.meta.caption,
      access_token: input.access_token,
    }),
  });
  const createJson = (await createRes.json()) as ContainerResponse;
  if (createJson.error || !createJson.id) {
    throw new Error(
      `instagram: create container: ${createJson.error?.message ?? 'no id returned'}`,
    );
  }
  const containerId = createJson.id;

  // Step 2: poll container status until FINISHED.
  await pollContainerReady(f, base, containerId, input.access_token);

  // Step 3: publish the container.
  const pubRes = await f(`${base}/${userId}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: input.access_token,
    }),
  });
  const pubJson = (await pubRes.json()) as PublishResponse;
  if (pubJson.error || !pubJson.id) {
    throw new Error(
      `instagram: publish: ${pubJson.error?.message ?? 'no id returned'}`,
    );
  }
  return {
    external_id: pubJson.id,
    url: pubJson.permalink ?? `https://instagram.com/reel/${pubJson.id}`,
  };
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function pollContainerReady(
  f: typeof fetch,
  base: string,
  containerId: string,
  accessToken: string,
): Promise<void> {
  const maxAttempts = 30; // 30 × 2s = 60s
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(2000);
    const res = await f(
      `${base}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
      { method: 'GET' },
    );
    const json = (await res.json()) as StatusResponse;
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR' || json.status_code === 'EXPIRED') {
      throw new Error(
        `instagram: container status=${json.status_code} ${json.error?.message ?? ''}`,
      );
    }
  }
  throw new Error('instagram: container did not reach FINISHED within 60s');
}
