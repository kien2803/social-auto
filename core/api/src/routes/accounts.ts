import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  AccountChannelSnapshot,
  AccountLanguageCode,
  AccountMetadata,
  AccountRow,
  Platform,
} from '@social-auto/shared';
import { ACCOUNT_LANGUAGE_CODES, isPlatform } from '@social-auto/shared';
import { decrypt, encrypt } from '@social-auto/shared/utils/crypto.js';
import type { ChannelInfo, GoogleOAuthClient } from '../google/client.js';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export interface AccountsDeps {
  accounts: AccountsRepo;
  posts: ScheduledPostsRepo;
  google?: GoogleOAuthClient;
  tokenEncryptionKey?: string;
  authMiddleware: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/** Wire shape for an account row returned by the API. Never includes tokens. */
interface AccountWire {
  id: string;
  platform: Platform;
  external_id: string;
  display_name: string;
  status: AccountRow['status'];
  created_at: number;
  metadata: AccountMetadata;
  channel: AccountChannelSnapshot;
}

function toWire(row: AccountRow): AccountWire {
  return {
    id: row.id,
    platform: row.platform,
    external_id: row.external_id,
    display_name: row.display_name,
    status: row.status,
    created_at: row.created_at,
    metadata: {
      content_category: row.content_category,
      language_code: row.language_code as AccountLanguageCode,
      purpose: row.purpose,
      link: row.link,
    },
    channel: {
      channel_handle: row.channel_handle,
      avatar_url: row.avatar_url,
      subscribers: row.subscribers,
      views: row.views,
      video_count: row.video_count,
      like_count: row.like_count,
      avg_watch_seconds: row.avg_watch_seconds,
      drop_off_pct: row.drop_off_pct,
      last_sync_at: row.last_sync_at,
    },
  };
}

function toSnapshot(info: ChannelInfo): AccountChannelSnapshot {
  return {
    channel_handle: info.handle ?? '',
    avatar_url: info.thumbnail_url ?? '',
    subscribers: info.subscribers,
    views: info.views,
    video_count: info.video_count,
    // The Data API v3 channels.list?part=statistics does not return like
    // count for the channel (only subscriber/view/video counts). Per-video
    // likes would require a separate videos.list call; we leave the field
    // null until a future enrichment pass populates it. avg_watch_seconds
    // and drop_off_pct require the YouTube Analytics API which is gated
    // behind `youtube.analytics.readonly` — also null until that scope is
    // added and re-authorization completes.
    like_count: null,
    avg_watch_seconds: null,
    drop_off_pct: null,
    last_sync_at: info.snapshot_at,
  };
}

/**
 * Public shape of a single video row surfaced by the Analytics page.
 * Mirrors the YouTube Data API `videos.list?part=snippet,statistics`
 * output we will eventually back with — for now the mock generator in
 * `mockChannelVideos` produces these from a deterministic seed tied to
 * the channel id so the UI can be exercised without live credentials.
 */
export interface ChannelVideo {
  id: string;
  title: string;
  thumbnail_url: string;
  published_at: number;
  duration_sec: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  url: string;
}

/**
 * Deterministic mock video feed for any platform. Returns an empty list
 * for non-YouTube platforms — the worker stubs for TikTok / IG / FB do
 * not persist a video history, so the row count would be 0 either way.
 *
 * Seeded by `channelId` so the same account always returns the same list
 * during a session. Volume / metrics scale lightly with the hash so
 * different accounts feel distinct rather than a single canned list.
 */
function listVideosForPlatform(platform: Platform, channelId: string): ChannelVideo[] {
  if (platform !== 'youtube' || !channelId) return [];
  return mockChannelVideos(channelId);
}

function mockChannelVideos(channelId: string): ChannelVideo[] {
  // FNV-1a 32-bit hash — fast, deterministic, no deps.
  let hash = 2166136261;
  for (let i = 0; i < channelId.length; i++) {
    hash ^= channelId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const seed = (hash >>> 0) || 1;
  const now = Date.now();
  const titles = [
    'How I edit videos in 10 minutes',
    'The setup that changed my workflow',
    'Quick tip: keyboard shortcuts',
    'Behind the scenes — last shoot',
    'Q&A with the community',
    'Field test: new camera gear',
    'Why I switched platforms',
    'Building the studio from scratch',
    'Color grading walkthrough',
    'A day in the life vlog',
  ];
  const out: ChannelVideo[] = [];
  for (let i = 0; i < 10; i++) {
    const titleSeed = (seed * (i + 1) * 2654435761) >>> 0;
    const title = titles[titleSeed % titles.length]!;
    const daysAgo = i * 5 + (titleSeed % 4);
    out.push({
      id: `${channelId}_mock_${i}`,
      title,
      thumbnail_url: '',
      published_at: now - daysAgo * 24 * 60 * 60 * 1000,
      duration_sec: 60 + (titleSeed % 600),
      view_count: 100 + (titleSeed % 50000),
      like_count: 5 + (titleSeed % 2000),
      comment_count: 1 + (titleSeed % 200),
      url: `https://youtube.com/watch?v=mock_${channelId}_${i}`,
    });
  }
  return out;
}

export function registerAccountRoutes(
  app: FastifyInstance,
  deps: AccountsDeps,
): void {
  // GET /accounts — list with safe filters.
  app.get<{
    Querystring: {
      search?: string;
      platform?: string;
      status?: string;
      content_category?: string;
      language_code?: string;
    };
  }>('/accounts', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const q = req.query;
    if (q.platform && !isPlatform(q.platform)) {
      return reply.code(400).send({ error: 'invalid_platform' });
    }
    if (q.status && !['active', 'expired', 'revoked'].includes(q.status)) {
      return reply.code(400).send({ error: 'invalid_status' });
    }
    if (
      q.language_code &&
      q.language_code !== '' &&
      !(ACCOUNT_LANGUAGE_CODES as readonly string[]).includes(q.language_code)
    ) {
      return reply.code(400).send({ error: 'invalid_language_code' });
    }
    const userId = (req as AuthenticatedRequest).userId;
    const rows = deps.accounts.listSlim({
      userId,
      search: q.search,
      platform: q.platform as Platform | undefined,
      status: q.status as AccountRow['status'] | undefined,
      contentCategory: q.content_category,
      languageCode: q.language_code as AccountLanguageCode | undefined,
    });
    return { accounts: rows.map(toWire) };
  });

  // GET /analytics — unchanged.
  app.get<{ Querystring: { account_id?: string } }>(
    '/analytics',
    { preHandler: deps.authMiddleware },
    async (req) => {
      const accountId =
        typeof req.query.account_id === 'string' && req.query.account_id
          ? req.query.account_id
          : undefined;
      const userId = (req as AuthenticatedRequest).userId;
      const rows = deps.posts.analyticsByAccount(accountId, userId);
      return { rows };
    },
  );

  // GET /accounts/:id — single account detail (was missing; the UI had to
  // filter the list client-side).
  app.get<{ Params: { id: string } }>('/accounts/:id', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const existing = deps.accounts.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.user_id !== userId) {
      return reply.code(403).send({ error: 'account_not_owned' });
    }
    return toWire(existing);
  });

  // PATCH /accounts/:id — accept metadata + display_name.
  app.patch<{
    Params: { id: string };
    Body: {
      display_name?: string;
      metadata?: Partial<AccountMetadata>;
    };
  }>('/accounts/:id', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const existing = deps.accounts.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.user_id !== userId) {
      return reply.code(403).send({ error: 'account_not_owned' });
    }
    const body = req.body ?? {};
    if (body.display_name !== undefined) {
      const name = body.display_name.trim();
      if (!name) return reply.code(400).send({ error: 'display_name_required' });
      if (name.length > 100) return reply.code(400).send({ error: 'display_name_too_long' });
      deps.accounts.updateDisplayName(req.params.id, name);
    }
    if (body.metadata) {
      const meta = body.metadata;
      if (meta.content_category !== undefined && meta.content_category.length > 64) {
        return reply.code(400).send({ error: 'content_category_too_long' });
      }
      if (meta.language_code !== undefined && meta.language_code !== '') {
        if (!(ACCOUNT_LANGUAGE_CODES as readonly string[]).includes(meta.language_code)) {
          return reply.code(400).send({ error: 'invalid_language_code' });
        }
      }
      if (meta.purpose !== undefined && meta.purpose.length > 500) {
        return reply.code(400).send({ error: 'purpose_too_long' });
      }
      if (meta.link !== undefined && meta.link.length > 500) {
        return reply.code(400).send({ error: 'link_too_long' });
      }
      deps.accounts.updateMetadata(req.params.id, {
        content_category: meta.content_category ?? undefined,
        language_code: meta.language_code ?? undefined,
        purpose: meta.purpose ?? undefined,
        link: meta.link ?? undefined,
      });
    }
    const updated = deps.accounts.findById(req.params.id);
    return toWire(updated!);
  });

  // DELETE /accounts/:id — unchanged.
  app.delete<{ Params: { id: string } }>('/accounts/:id', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const existing = deps.accounts.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.user_id !== userId) {
      return reply.code(403).send({ error: 'account_not_owned' });
    }
    deps.accounts.deleteById(req.params.id);
    return { ok: true };
  });

  // GET /accounts/:id/stats — per-account scheduled-post counts.
  app.get<{ Params: { id: string } }>('/accounts/:id/stats', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const existing = deps.accounts.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.user_id !== userId) {
      return reply.code(403).send({ error: 'account_not_owned' });
    }
    return deps.posts.countByStatusForAccount(req.params.id);
  });

  // GET /accounts/:id/videos — latest public videos for the channel. YouTube
  // for now; TikTok / IG / FB return an empty list because the worker stubs
  // don't persist a video history. The route exists so the Analytics page
  // single-account view has a uniform surface across platforms.
  app.get<{ Params: { id: string } }>('/accounts/:id/videos', { preHandler: deps.authMiddleware }, async (req, reply) => {
    const userId = (req as AuthenticatedRequest).userId;
    const existing = deps.accounts.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.user_id !== userId) {
      return reply.code(403).send({ error: 'account_not_owned' });
    }
    return { videos: listVideosForPlatform(existing.platform, existing.external_id) };
  });

  // POST /accounts/:id/sync — refresh the YouTube channel snapshot.
  app.post<{ Params: { id: string } }>('/accounts/:id/sync', { preHandler: deps.authMiddleware }, async (req, reply) => {
    if (!deps.google || !deps.tokenEncryptionKey) {
      return reply.code(503).send({ error: 'sync_unavailable' });
    }
    const userId = (req as AuthenticatedRequest).userId;
    const existing = deps.accounts.findById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.user_id !== userId) {
      return reply.code(403).send({ error: 'account_not_owned' });
    }
    if (existing.platform !== 'youtube') {
      return reply.code(400).send({ error: 'sync_only_youtube' });
    }
    let decryptedAccess: string | null = null;
    try {
      decryptedAccess = existing.oauth_access_token
        ? decrypt(existing.oauth_access_token, deps.tokenEncryptionKey)
        : null;
    } catch {
      return reply.code(401).send({ error: 'token_decrypt_failed' });
    }
    if (!decryptedAccess) {
      // Try refresh.
      try {
        const decryptedRefresh = decrypt(existing.oauth_refresh_token, deps.tokenEncryptionKey);
        const tokens = await deps.google.refresh(decryptedRefresh);

        deps.accounts.updateTokens(existing.id, {
          access_token: encrypt(tokens.access_token, deps.tokenEncryptionKey),
          expires_at: tokens.expires_at,
        });
        decryptedAccess = tokens.access_token;
      } catch {
        return reply.code(401).send({ error: 'token_refresh_failed' });
      }
    }
    let info: ChannelInfo;
    try {
      info = await deps.google.getMyChannel(decryptedAccess);
    } catch {
      return reply.code(502).send({ error: 'google_api_error' });
    }
    const snapshot = toSnapshot(info);
    // Real YouTube only: pull the channel's recent uploads and sum the
    // like_count across them so the Analytics page can show a "channel
    // likes" number derived from real per-video stats. The Data API v3
    // doesn't expose channel-wide like_count, only per-video, so this is
    // the cheapest approximation. avg_watch_seconds + drop_off_pct remain
    // null until the Analytics API scope lands. Mock path returns the same
    // deterministic seed so the UI is exercised end-to-end.
    if (deps.google.listRecentVideos && existing.external_id) {
      try {
        const videos = await deps.google.listRecentVideos(
          decryptedAccess,
          existing.external_id,
        );
        const summed = videos.reduce(
          (acc, v) => acc + (v.like_count ?? 0),
          0,
        );
        if (videos.length > 0) snapshot.like_count = summed;
      } catch {
        // Non-fatal — like count is a nice-to-have; the rest of the
        // snapshot still applies if the videos call fails (e.g. quota).
      }
    }
    deps.accounts.updateChannelSnapshot(existing.id, snapshot);
    return { id: existing.id, channel: snapshot };
  });
}
