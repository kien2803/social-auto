import type { Platform, Visibility } from '../repos/types';
import type { Env } from '../env';

export interface PublishMeta {
  /** First line of the caption — the platform title. */
  title: string;
  /** Caption minus first line — platform description. */
  description: string;
  /** Full caption text for this account (per-platform override applied). */
  caption: string;
  tags?: string[];
  visibility: Visibility;
  /** Meta graph node: IG business user id or FB page id. */
  external_id?: string;
  /** Public URL the platform can pull the video from (Instagram requires). */
  video_url?: string;
}

export interface PublishVideo {
  /** R2 object key (videos/<user>/<id>/<filename>). */
  key: string;
  size_bytes: number;
  mime: string;
  duration_sec: number | null;
}

export interface PublishResult {
  external_id: string;
  url?: string;
}

/**
 * Resumable upload state persisted on the post row (platform_state) between
 * attempts — a retry RESUMES the same remote session instead of starting a
 * new one, which is what actually prevents duplicate posts after a
 * mid-upload failure or a lost success response.
 */
export type PublishState = Record<string, unknown>;

export interface PublishInput {
  env: Env;
  access_token: string;
  video: PublishVideo;
  meta: PublishMeta;
  state: PublishState | null;
  /** Persist intermediate state after each remote phase. */
  saveState: (state: PublishState) => Promise<void>;
}

export interface Publisher {
  readonly platform: Platform;
  validate(meta: PublishMeta, video: PublishVideo): { ok: boolean; errors: string[] };
  upload(input: PublishInput): Promise<PublishResult>;
}

/** Carries updated resumable state on a failed attempt. */
export class PublishError extends Error {
  constructor(message: string, public readonly state?: PublishState) {
    super(message);
    this.name = 'PublishError';
  }
}

/** Read a byte range out of R2 — chunked uploads never buffer the file. */
export async function r2Range(env: Env, key: string, offset: number, length: number): Promise<Uint8Array> {
  const obj = await env.STORAGE.get(key, { range: { offset, length } });
  if (!obj) throw new Error(`r2_missing: ${key}`);
  return new Uint8Array(await obj.arrayBuffer());
}

export const PLATFORM_CAPTION_LIMITS: Record<Platform, number> = {
  youtube: 5000,
  tiktok: 2200,
  instagram: 2200,
  facebook: 2200,
};

export const PLATFORM_TITLE_LIMITS: Record<Platform, number> = {
  youtube: 100,
  tiktok: 150,
  instagram: 150,
  facebook: 150,
};

export const PLATFORM_MAX_DURATION_SEC: Record<Platform, number> = {
  youtube: 12 * 60 * 60,
  tiktok: 10 * 60,
  instagram: 90,
  facebook: 90 * 60,
};
