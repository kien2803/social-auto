import type { Platform, Visibility } from '../repos/types';

/** One issue found by a preflight check. `fix` tells the user how to
 *  resolve it — actionable, never vague. */
export interface PreflightIssue {
  code: string;
  message: string;
  fix?: string;
}

/** What the client-side/media checks learned about the stored file. */
export interface VideoInspection {
  mime: string;
  format: 'mp4' | 'mov' | 'webm' | null;
  size_bytes: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  /** Reduced aspect ratio, e.g. "16:9" — null when dims unknown. */
  aspect: string | null;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
}

/** The exact fields the post's publisher will send — minus secrets. */
export interface PublishPreview {
  title: string;
  description: string;
  caption: string;
  tags: string[];
  visibility: Visibility;
}

export interface AccountPreflight {
  account_id: string;
  platform: Platform;
  display_name: string;
  /** true when errors[] is empty — the account can be scheduled. */
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  preview: PublishPreview;
}

export interface PreflightResponse {
  /** false if any account or the video has a blocking error. */
  ok: boolean;
  video: VideoInspection | null;
  accounts: AccountPreflight[];
  generated_at: number;
}
