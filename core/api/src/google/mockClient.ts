import type { ChannelInfo, GoogleOAuthClient, GoogleTokens, VideoStats } from './client.js';
/**
 * In-memory mock of the Google OAuth client.
 * Use in tests so we never hit real Google endpoints.
 */
export interface MockGoogleConfig {
  /** Pre-set channel to return for verify (deprecated — use `channels` for multi-account). */
  channel?: ChannelInfo;
  /** Channel pool used in round-robin order across successive connect calls. */
  channels?: ChannelInfo[];
  /** Force exchangeCode to fail. */
  failExchange?: boolean;
  /** Force refresh to fail. */
  failRefresh?: boolean;
  /** When set, getMyChannel throws with this message (e.g. expired access). */
  failGetChannel?: string;
}

function defaultChannel(overrides: Partial<ChannelInfo>): ChannelInfo {
  return {
    id: '',
    title: 'Mock Channel',
    handle: '',
    thumbnail_url: undefined,
    subscribers: null,
    views: null,
    video_count: null,
    snapshot_at: 0,
    ...overrides,
  };
}

function asMockChannel(raw: ChannelInfo): ChannelInfo {
  // ChannelInfo shape grew with statistics + handle; older tests / fixtures
  // may construct a channel without those fields. Fill in zeros so the new
  // required fields are present and the OAuth callback still inserts a row.
  return defaultChannel({
    ...raw,
    handle: raw.handle ?? '',
    subscribers: raw.subscribers ?? 0,
    views: raw.views ?? 0,
    video_count: raw.video_count ?? 0,
    snapshot_at: raw.snapshot_at ?? Date.now(),
  });
}

export function createMockGoogleClient(cfg: MockGoogleConfig = {}): GoogleOAuthClient {
  let tokenCounter = 0;
  let channelCounter = 0;
  const channels: ChannelInfo[] = (cfg.channels ?? [
    defaultChannel({
      id: 'UC_mock_channel_1',
      title: 'Mock Channel 1',
      handle: '@mockchannel1',
      thumbnail_url: 'https://example.com/thumb1.jpg',
      subscribers: 100,
      views: 1000,
      video_count: 5,
    }),
    defaultChannel({
      id: 'UC_mock_channel_2',
      title: 'Mock Channel 2',
      handle: '@mockchannel2',
      thumbnail_url: 'https://example.com/thumb2.jpg',
      subscribers: 200,
      views: 2000,
      video_count: 10,
    }),
    defaultChannel({
      id: 'UC_mock_channel_3',
      title: 'Mock Channel 3',
      handle: '@mockchannel3',
      thumbnail_url: 'https://example.com/thumb3.jpg',
      subscribers: 300,
      views: 3000,
      video_count: 15,
    }),
  ]).map(asMockChannel);
  const fallbackChannel: ChannelInfo = asMockChannel(
    cfg.channel ?? channels[0]!,
  );

  return {
    buildAuthUrl(state: string, redirectUri?: string) {
      // The mock skips the Google hop entirely: redirect straight to the local
      // /auth/callback with a synthetic code so the simulator (and the
      // server's own OAuth test path) can run end-to-end without ever dialing
      // accounts.google.com. The real client builds the same URL with Google's
      // hostname — both paths converge at /auth/callback.
      //
      // When `redirectUri` is provided (typically derived from the inbound
      // request's host), use it so the browser stays on the same origin as
      // the web app (e.g. localhost:5173 in dev). Otherwise fall back to the
      // API origin (localhost:3000) — used by the simulator and unit tests.
      const target = redirectUri ?? 'http://localhost:3000/auth/callback';
      const u = new URL(target);
      u.searchParams.set('state', state);
      u.searchParams.set('code', `mock-code-${++tokenCounter}`);
      return u.toString();
    },
    async exchangeCode(code: string): Promise<GoogleTokens> {
      if (cfg.failExchange) throw new Error('mock: exchange failed');
      tokenCounter += 1;
      // The simulator increments the channel per connect. Mock supports this by
      // binding the channel id to the code so getMyChannel() (called immediately
      // after exchangeCode) returns the right channel for this OAuth round-trip.
      const idx = (channelCounter++) % channels.length;
      const ch = channels[idx] ?? fallbackChannel;
      (globalThis as Record<string, unknown>)['__mock_google_code_channel'] = { code, channel: ch };
      return {
        access_token: `mock-access-${tokenCounter}-${code}`,
        expires_at: Date.now() + 3600_000,
        refresh_token: `mock-refresh-${tokenCounter}-${code}`,
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        token_type: 'Bearer',
      };
    },

    async refresh(refreshToken: string): Promise<GoogleTokens> {
      if (cfg.failRefresh) throw new Error('mock: refresh failed');
      return {
        access_token: `mock-access-refreshed-${refreshToken}`,
        expires_at: Date.now() + 3600_000,
        refresh_token: refreshToken,
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        token_type: 'Bearer',
      };
    },

    async getMyChannel(accessToken: string): Promise<ChannelInfo> {
      if (cfg.failGetChannel) throw new Error(cfg.failGetChannel);
      // If the access token was just minted, return the channel bound at
      // exchange time so the OAuth callback inserts the right row. Otherwise
      // (status checks) fall back to the channel derived from the token.
      const map = (globalThis as Record<string, unknown>)['__mock_google_code_channel'] as
        | { code: string; channel: ChannelInfo }
        | undefined;
      if (map && accessToken.endsWith(map.code)) return map.channel;
      if (!accessToken.startsWith('mock-access')) {
        throw new Error('mock: invalid access token');
      }
      // Status checks for previously-minted tokens — derive a stable channel
      // from the refresh_token segment so /auth/youtube/status returns the
      // matching account.
      const match = /mock-access-refreshed-(.+)/.exec(accessToken);
      if (match) {
        const seg = match[1] ?? '';
        const codeMatch = /mock-code-(\d+)/.exec(seg) ?? /mock-refresh-\d+-mock-code-(\d+)/.exec(seg);
        if (codeMatch) {
          const idx = (Number(codeMatch[1]) % channels.length + channels.length) % channels.length;
          return channels[idx] ?? fallbackChannel;
        }
      }
      return fallbackChannel;
    },

    async listRecentVideos(
      _accessToken: string,
      channelId: string,
      maxResults = 10,
    ): Promise<VideoStats[]> {
      if (!channelId) return [];
      // Deterministic FNV-1a 32-bit hash so the same channel always yields
      // the same seed. Mirrors the mockChannelVideos generator used by the
      // /accounts/:id/videos HTTP route so the analytics view is consistent
      // between the real-OAuth sync and the mock path.
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
      const out: VideoStats[] = [];
      const limit = Math.min(maxResults, 50);
      for (let i = 0; i < limit; i++) {
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
        });
      }
      return out;
    },
   };
}
