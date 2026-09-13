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

export interface FacebookPublisherConfig {
  useMock: boolean;
  appId: string;
  /** Graph API version. Defaults to v24.0. */
  apiVersion?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

export class FacebookPublisher implements Publisher {
  readonly platform: Platform = 'facebook';
  private cfg: FacebookPublisherConfig;

  constructor(cfg: FacebookPublisherConfig) {
    this.cfg = cfg;
  }

  validate(meta: UploadMeta, video: PublisherVideo): PublisherValidation {
    const errors: string[] = [];
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.facebook) {
      errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.facebook} chars`);
    }
    if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC.facebook) {
      errors.push(`video exceeds ${PLATFORM_MAX_DURATION_SEC.facebook}s FB limit`);
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
  if (input.access_token && !input.access_token.startsWith('mock-fb-')) {
    throw new Error('facebook: invalid access token (stub)');
  }
  const id = `mock-fb-${Date.now()}`;
  return { external_id: id, url: `https://facebook.com/watch/?v=${id}` };
}

interface VideoUploadResponse {
  id?: string;
  permalink_url?: string;
  error?: { code?: number; message?: string };
}

async function realUpload(
  cfg: FacebookPublisherConfig,
  input: PublisherInput,
): Promise<PublisherUploadResult> {
  const f = cfg.fetchImpl ?? fetch;
  const apiVersion = cfg.apiVersion ?? DEFAULT_API_VERSION;
  const base = `${GRAPH_BASE}/${apiVersion}`;

  // Page id is the account's external_id; page access token is the
  // access_token. Both flow from the OAuth callback.
  const pageId = input.meta.external_id ?? '';
  if (!pageId) {
    throw new Error('facebook: missing meta.external_id (Page id)');
  }
  const accessToken = input.access_token;

  // Sanity check the on-disk file.
  const stat = statSync(input.video.file_path);
  if (stat.size !== input.video.size_bytes) {
    throw new Error(
      `facebook: size_mismatch db=${input.video.size_bytes} disk=${stat.size}`,
    );
  }

  // Build a multipart/form-data body. We don't import a FormData shim —
  // multipart with file content is small enough to construct inline.
  const boundary = `----fb${Math.random().toString(36).slice(2)}`;
  const fileBytes = await readFile(input.video.file_path);
  const parts: Uint8Array[] = [];
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  parts.push(enc(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="description"\r\n\r\n` +
    `${input.meta.caption}\r\n`,
  ));
  parts.push(enc(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="title"\r\n\r\n` +
    `${input.meta.title}\r\n`,
  ));
  parts.push(enc(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="video.mp4"\r\n` +
    `Content-Type: ${input.video.mime || 'video/mp4'}\r\n\r\n`,
  ));
  parts.push(fileBytes);
  parts.push(enc(`\r\n--${boundary}--\r\n`));
  // Concatenate the parts.
  const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const body = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    body.set(p, off);
    off += p.byteLength;
  }

  const res = await f(`${base}/${pageId}/videos`, {
    method: 'POST',
    headers: {
      authorization: `OAuth ${accessToken}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const json = (await res.json()) as VideoUploadResponse;
  if (json.error || !json.id) {
    throw new Error(
      `facebook: upload: ${json.error?.message ?? 'no id returned'}`,
    );
  }
  return {
    external_id: json.id,
    url: json.permalink_url ?? `https://facebook.com/watch/?v=${json.id}`,
  };
}

async function readFile(path: string): Promise<Uint8Array> {
  const { readFile: fsReadFile } = await import('node:fs/promises');
  const buf = await fsReadFile(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
