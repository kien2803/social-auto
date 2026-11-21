import type { Env } from '../env';
import type { AccountRow, Platform, VideoRow } from '../repos/types';
import { getPublisher } from '../publish';
import { buildPublishMeta } from '../publish/buildMeta';
import { tiktokTitle } from '../publish/tiktok';
import { PLATFORM_MAX_DURATION_SEC } from '../publish/types';
import { signMediaUrl } from '../lib/signedMedia';
import { PLATFORM_ASPECTS, PLATFORM_MAX_BITRATE_KBPS, PLATFORM_MAX_RESOLUTION } from './limits';
import type { AccountPreflight, PreflightIssue, PublishPreview } from './types';

/** Tokens expiring within this window get a warning — refreshable
 *  platforms self-heal at publish time, Meta tokens don't. */
const EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000;

export interface PreflightInput {
  caption: string;
  perPlatformCaption?: string;
  platformParams?: string | null;
  visibility: 'public' | 'unlisted' | 'private';
}

/** Disconnected / expired / unreadable grant — blocking, with the fix. */
function readiness(account: AccountRow): { errors: PreflightIssue[]; warnings: PreflightIssue[] } {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  if (account.status === 'expired') {
    errors.push({
      code: 'account_expired',
      message: `Token for ${account.display_name} has expired.`,
      fix: 'Go to Accounts → reconnect this channel, then schedule again.',
    });
  } else if (account.status === 'revoked') {
    errors.push({
      code: 'account_revoked',
      message: `Access to ${account.display_name} was revoked on ${account.platform}.`,
      fix: 'Reconnect the account in Accounts to restore publishing.',
    });
  } else if (account.status !== 'active') {
    errors.push({
      code: 'account_inactive',
      message: `${account.display_name} is not active (${account.status}).`,
      fix: 'Reconnect the account in Accounts.',
    });
  }

  if (!account.oauth_refresh_token) {
    errors.push({
      code: 'grant_missing',
      message: 'No stored credential for this account.',
      fix: 'Reconnect the account in Accounts.',
    });
  }

  const exp = account.token_expires_at;
  if (exp !== null && errors.length === 0) {
    const meta = account.platform === 'facebook' || account.platform === 'instagram';
    if (exp <= Date.now()) {
      errors.push({
        code: 'token_expired',
        message: 'The access token is already expired.',
        fix: meta
          ? 'Reconnect the account — Meta tokens cannot be refreshed automatically.'
          : 'Reconnect the account if automatic refresh keeps failing.',
      });
    } else if (meta && exp - Date.now() < EXPIRY_WARN_MS) {
      warnings.push({
        code: 'token_expires_soon',
        message: `Meta token expires ${new Date(exp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — it cannot be refreshed.`,
        fix: 'Plan to reconnect before that date, or scheduled posts will fail.',
      });
    }
  }
  return { errors, warnings };
}

/**
 * Per-account assessment: readiness → publisher.validate (authoritative
 * rules) → media warnings → the exact publish payload as a preview.
 */
export async function assessAccount(
  env: Env,
  account: AccountRow,
  video: VideoRow,
  input: PreflightInput,
): Promise<AccountPreflight> {
  const platform = account.platform;
  const { errors, warnings } = readiness(account);
  const caption = input.perPlatformCaption ?? input.caption;

  const meta = await buildPublishMeta({
    caption,
    visibility: input.visibility,
    platformParams: input.platformParams ?? null,
    platform,
    externalId: account.external_id,
    videoId: video.id,
    signVideoUrl: (id) => signMediaUrl(env, id),
  });

  const pubVideo = {
    key: video.file_path,
    size_bytes: video.size_bytes,
    mime: video.mime,
    duration_sec: video.duration_sec,
  };

  // Authoritative platform rules — same call the publisher makes at
  // publish time, so nothing here duplicates business logic.
  const publisher = getPublisher(platform);
  if (publisher) {
    for (const msg of publisher.validate(meta, pubVideo).errors) {
      errors.push({ code: 'platform_rule', message: msg });
    }
  } else {
    errors.push({ code: 'no_publisher', message: `Publishing to ${platform} is not supported.` });
  }

  // Media warnings — advisory only, platforms recompress or crop.
  if (video.duration_sec && video.duration_sec > PLATFORM_MAX_DURATION_SEC[platform]) {
    // A publisher.validate already reports this for tiktok/ig/fb; youtube
    // only checks duration presence, so flag the 12 h cap there too.
    if (platform === 'youtube') {
      errors.push({ code: 'duration_too_long', message: `Video exceeds YouTube's ${PLATFORM_MAX_DURATION_SEC.youtube / 3600}h limit.` });
    }
  }
  const aspect = video.width && video.height ? aspectStr(video.width, video.height) : null;
  if (aspect && !PLATFORM_ASPECTS[platform].includes(aspect)) {
    warnings.push({
      code: 'aspect_mismatch',
      message: `${aspect} isn't a typical ${platform} aspect (${PLATFORM_ASPECTS[platform].join(', ')}) — the platform may crop or letterbox it.`,
      fix: 'Re-export in a supported aspect ratio for a cleaner result.',
    });
  }
  if (video.width && video.height) {
    const [mw, mh] = PLATFORM_MAX_RESOLUTION[platform];
    if (video.width > mw || video.height > mh) {
      warnings.push({
        code: 'resolution_high',
        message: `${video.width}×${video.height} exceeds ${platform}'s ${mw}×${mh} recommended maximum — it will be recompressed.`,
      });
    }
  }
  if (video.duration_sec && video.duration_sec > 0) {
    const kbps = (video.size_bytes * 8) / video.duration_sec / 1000;
    if (kbps > PLATFORM_MAX_BITRATE_KBPS[platform]) {
      warnings.push({
        code: 'bitrate_high',
        message: `~${Math.round(kbps).toLocaleString()} kbps exceeds ${platform}'s ${PLATFORM_MAX_BITRATE_KBPS[platform].toLocaleString()} kbps ceiling — it will be recompressed.`,
      });
    }
  }
  if (platform === 'tiktok') {
    warnings.push({
      code: 'visibility_forced',
      message: 'Unverified TikTok apps post as SELF_ONLY regardless of the visibility you pick.',
      fix: 'The post will only be visible to you until the TikTok app passes review.',
    });
  }

  // Preview — the payload as the platform will see it. TikTok merges
  // hashtags into its title field; mirror that transform exactly.
  const preview: PublishPreview = {
    title: platform === 'tiktok' ? tiktokTitle(meta) : meta.title,
    description: meta.description,
    caption: meta.caption,
    tags: meta.tags ?? [],
    visibility: platform === 'tiktok' ? 'private' : meta.visibility,
  };

  return {
    account_id: account.id,
    platform,
    display_name: account.display_name,
    ok: errors.length === 0,
    errors,
    warnings,
    preview,
  };
}

function aspectStr(w: number, h: number): string {
  const g = (function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); })(w, h);
  return `${w / g}:${h / g}`;
}

export type { Platform };
