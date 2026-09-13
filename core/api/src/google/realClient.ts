import { google } from 'googleapis';
import type { ChannelInfo, GoogleOAuthClient, GoogleTokens, VideoStats } from './client.js';

// Scopes used by the API on the user's behalf. Both are needed:
//   - youtube.upload   — publish videos (worker)
//   - youtube.readonly — read channel info via channels.list?mine=true (API
//     status check + sync). Without readonly, `getMyChannel` returns 403.
// The OAuth consent screen in Google Cloud Console must include BOTH
// scopes — see plans/core/phase-0-bootstrap/google-cloud-setup.md.
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export interface RealGoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Build a ChannelInfo from a YouTube Data API channels.list response item.
 * Pulls statistics + contentDetails in addition to snippet. No browser API
 * key is required because we are authenticating as the channel owner.
 */
function toChannelInfo(item: {
  id?: string | null;
  snippet?: {
    title?: string | null;
    customUrl?: string | null;
    thumbnails?: {
      default?: { url?: string | null } | null;
      medium?: { url?: string | null } | null;
      high?: { url?: string | null } | null;
    } | null;
  } | null;
  statistics?: {
    subscriberCount?: string | null;
    viewCount?: string | null;
    videoCount?: string | null;
  } | null;
}): ChannelInfo {
  const stat = item.statistics ?? {};
  const snippet = item.snippet ?? {};
  const handle = (snippet.customUrl ?? '').toString();
  // YouTube returns up to three thumbnail sizes (default/medium/high).
  // Prefer the largest available so the SPA can render a sharp avatar.
  const thumbs = snippet.thumbnails ?? {};
  const thumbnailUrl =
    thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? undefined;
  return {
    id: (item.id ?? '').toString(),
    title: (snippet.title ?? 'Unknown channel').toString(),
    handle: handle.startsWith('@') ? handle : handle ? `@${handle}` : '',
    thumbnail_url: thumbnailUrl,
    subscribers: stat.subscriberCount != null ? Number(stat.subscriberCount) : null,
    views: stat.viewCount != null ? Number(stat.viewCount) : null,
    video_count: stat.videoCount != null ? Number(stat.videoCount) : null,
    snapshot_at: Date.now(),
  };
}
function toVideoStats(item: {
  id?: string | null;
  snippet?: {
    title?: string | null;
    thumbnails?: { default?: { url?: string | null } | null } | null;
    publishedAt?: string | null;
  } | null;
  contentDetails?: {
    duration?: string | null;
  } | null;
  statistics?: {
    viewCount?: string | null;
    likeCount?: string | null;
    commentCount?: string | null;
  } | null;
}): VideoStats {
  const snip = item.snippet ?? {};
  const stat = item.statistics ?? {};
  const cd = item.contentDetails ?? {};
  return {
    id: (item.id ?? '').toString(),
    title: (snip.title ?? '').toString(),
    thumbnail_url: snip.thumbnails?.default?.url ?? '',
    // publishedAt is RFC 3339; parse with Date and convert to ms epoch.
    published_at: snip.publishedAt ? Date.parse(snip.publishedAt) : Date.now(),
    // ISO 8601 duration (e.g. "PT1M30S"); seconds conversion handled
    // crudely — good enough for the analytics display.
    duration_sec: cd.duration ? parseIso8601ToSeconds(cd.duration) : null,
    view_count: stat.viewCount != null ? Number(stat.viewCount) : null,
    like_count: stat.likeCount != null ? Number(stat.likeCount) : null,
    comment_count: stat.commentCount != null ? Number(stat.commentCount) : null,
  };
}

/** Parse PT#H#M#S into total seconds. Returns null on malformed input. */
function parseIso8601ToSeconds(iso: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const mm = Number(m[2] ?? 0);
  const ss = Number(m[3] ?? 0);
  return h * 3600 + mm * 60 + ss;
}

export function createRealGoogleClient(cfg: RealGoogleConfig): GoogleOAuthClient {
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);

  return {
    buildAuthUrl(state: string, _redirectUri?: string) {
      // _redirectUri is accepted to match the GoogleOAuthClient interface but
      // ignored here — real Google OAuth uses the redirect URI configured on
      // the OAuth2 client at construction time. The caller must match that
      // URL in GOOGLE_REDIRECT_URI for the token exchange to succeed.
      void _redirectUri;
      return oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
        state,
      });
    },

    async exchangeCode(code: string): Promise<GoogleTokens> {
      const { tokens } = await oauth2.getToken(code);
      if (!tokens.access_token) throw new Error('No access_token in response');
      const expires_at = tokens.expiry_date ?? Date.now() + 3600_000;
      return {
        access_token: tokens.access_token,
        expires_at,
        refresh_token: tokens.refresh_token ?? null,
        scope: tokens.scope ?? SCOPES.join(' '),
        token_type: tokens.token_type ?? 'Bearer',
      };
    },

    async refresh(refreshToken: string): Promise<GoogleTokens> {
      oauth2.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2.refreshAccessToken();
      if (!credentials.access_token) throw new Error('No access_token in refresh response');
      const expires_at = credentials.expiry_date ?? Date.now() + 3600_000;
      return {
        access_token: credentials.access_token,
        expires_at,
        refresh_token: credentials.refresh_token ?? refreshToken,
        scope: credentials.scope ?? SCOPES.join(' '),
        token_type: credentials.token_type ?? 'Bearer',
      };
    },

    async getMyChannel(accessToken: string): Promise<ChannelInfo> {
      oauth2.setCredentials({ access_token: accessToken });
      const youtube = google.youtube({ version: 'v3', auth: oauth2 });
      const res = await youtube.channels.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        mine: true,
      });
      const items = res.data.items ?? [];
      const first = items[0];
      if (!first || !first.id) throw new Error('No channel found for this account');
      return toChannelInfo(first);
    },
    async getChannelStats(accessToken: string, channelId: string): Promise<ChannelInfo> {
      oauth2.setCredentials({ access_token: accessToken });
      const youtube = google.youtube({ version: 'v3', auth: oauth2 });
      const res = await youtube.channels.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: [channelId],
      });
      const items = res.data.items ?? [];
      const first = items[0];
      if (!first || !first.id) throw new Error(`Channel not found: ${channelId}`);
      return toChannelInfo(first);
    },

    async listRecentVideos(
      accessToken: string,
      channelId: string,
      maxResults = 50,
    ): Promise<VideoStats[]> {
      oauth2.setCredentials({ access_token: accessToken });
      const youtube = google.youtube({ version: 'v3', auth: oauth2 });
      // search.list returns video ids ordered by upload date desc; we then
      // fetch full snippet + statistics + contentDetails in one videos.list
      // call. The two-step pattern is the documented YouTube recipe for
      // "most recent uploads" with statistics — videos.list alone can't
      // order by date without search.list first.
      const search = await youtube.search.list({
        channelId,
        order: 'date',
        type: ['video'],
        maxResults,
      });
      const ids = (search.data.items ?? [])
        .map((it) => it.id?.videoId)
        .filter((id): id is string => typeof id === 'string');
      if (ids.length === 0) return [];
      const videos = await youtube.videos.list({
        id: ids,
        part: ['snippet', 'statistics', 'contentDetails'],
      });
      return (videos.data.items ?? []).map(toVideoStats);
    },
  };
}
