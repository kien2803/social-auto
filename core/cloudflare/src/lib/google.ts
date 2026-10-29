import type { Env } from '../env';

/** Minimal YouTube Data API v3 client — fetch-based, no googleapis dep. */

export interface ChannelInfo {
  id: string;
  title: string;
  handle: string;
  thumbnail_url?: string;
  subscribers: number | null;
  views: number | null;
  video_count: number | null;
  snapshot_at: number;
}

export interface VideoStats {
  id: string;
  title: string;
  thumbnail_url: string;
  published_at: number;
  duration_sec: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
}

interface YtChannelItem {
  id?: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
}

async function ytGet(path: string, accessToken: string, params: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`youtube_${path}_${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function refreshAccessToken(env: Env, refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error ?? 'refresh_failed');
  return {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export async function getMyChannel(accessToken: string): Promise<ChannelInfo> {
  const data = await ytGet('channels', accessToken, {
    part: 'snippet,statistics',
    mine: 'true',
  });
  const item = (data.items as YtChannelItem[] | undefined)?.[0];
  if (!item?.id) throw new Error('no_channel');
  const t = item.snippet?.thumbnails ?? {};
  const handle = item.snippet?.customUrl ?? '';
  return {
    id: item.id,
    title: item.snippet?.title ?? 'Unknown channel',
    handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '',
    thumbnail_url: t.high?.url ?? t.medium?.url ?? t.default?.url,
    subscribers: item.statistics?.subscriberCount != null ? Number(item.statistics.subscriberCount) : null,
    views: item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : null,
    video_count: item.statistics?.videoCount != null ? Number(item.statistics.videoCount) : null,
    snapshot_at: Date.now(),
  };
}

interface YtSearchItem {
  id?: { videoId?: string };
}
interface YtVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

function isoDuration(iso?: string): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Most recent uploads with stats — search.list for ids, videos.list for data. */
export async function listRecentVideos(
  accessToken: string,
  channelId: string,
  maxResults = 25,
): Promise<VideoStats[]> {
  const search = await ytGet('search', accessToken, {
    channelId,
    order: 'date',
    type: 'video',
    maxResults: String(maxResults),
    part: 'id',
  });
  const ids = ((search.items as YtSearchItem[] | undefined) ?? [])
    .map((it) => it.id?.videoId)
    .filter((id): id is string => typeof id === 'string');
  if (!ids.length) return [];
  const videos = await ytGet('videos', accessToken, {
    id: ids.join(','),
    part: 'snippet,statistics,contentDetails',
  });
  return ((videos.items as YtVideoItem[] | undefined) ?? []).map((it) => ({
    id: it.id ?? '',
    title: it.snippet?.title ?? '',
    thumbnail_url: it.snippet?.thumbnails?.default?.url ?? '',
    published_at: it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : Date.now(),
    duration_sec: isoDuration(it.contentDetails?.duration),
    view_count: it.statistics?.viewCount != null ? Number(it.statistics.viewCount) : null,
    like_count: it.statistics?.likeCount != null ? Number(it.statistics.likeCount) : null,
    comment_count: it.statistics?.commentCount != null ? Number(it.statistics.commentCount) : null,
  }));
}
