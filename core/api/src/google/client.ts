/**
 * Per-video statistics. Returned by `listRecentVideos` so the API can
 * sum likes / views across the channel and persist the totals as the
 * `like_count` snapshot field. Real OAuth needs `youtube.readonly` scope.
 */
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

export interface GoogleTokens {
  access_token: string;
  /** Unix epoch in milliseconds. */
  expires_at: number;
  /** OAuth refresh token. */
  refresh_token: string | null;
  scope: string;
  token_type: string;
}

/**
 * Public channel info returned by `getMyChannel`. Extended with statistics
 * and content-details fields so a single OAuth-authenticated call can both
 * mint a new account row and seed the channel snapshot. No browser API key
 * is needed — these fields are reachable via the user's access token.
 */
export interface ChannelInfo {
  id: string;
  title: string;
  /** Public handle, e.g. "@mychannel". Empty string when none. */
  handle: string;
  thumbnail_url?: string;
  /** Public subscriber count, or null if hidden. */
  subscribers: number | null;
  /** Public total view count, or null if hidden. */
  views: number | null;
  /** Public video count. */
  video_count: number | null;
  /** Unix ms of when this snapshot was fetched. */
  snapshot_at: number;
}

export interface GoogleOAuthClient {
  /**
   * Generate URL user should be redirected to in order to authorize.
   * `redirectUri` overrides the configured redirect — needed by the mock
   * to send the browser back through the Vite dev proxy (5173) instead
   * of straight to the API (3000). The real Google path ignores this
   * argument; it uses the OAuth client config at construction time.
   */
  buildAuthUrl(state: string, redirectUri?: string): string;
  /** Exchange `code` for tokens. */
  exchangeCode(code: string): Promise<GoogleTokens>;
  /** Use refresh token to get a new access token. */
  refresh(refreshToken: string): Promise<GoogleTokens>;
  /** Get channel info for the currently authorized user. */
  getMyChannel(accessToken: string): Promise<ChannelInfo>;
  /**
   * Refresh the public stats for a known channel id. Same OAuth scopes work;
   * the difference vs getMyChannel is the lookup-by-id rather than
   * `mine=true`. Optional in the contract — mocks and partial implementations
   * may delegate to getMyChannel instead.
   */
  getChannelStats?(accessToken: string, channelId: string): Promise<ChannelInfo>;
  /**
   * List the channel's most recent public videos. Real OAuth requires the
   * `youtube.readonly` scope to call `search.list?channelId=…` and
   * `videos.list?part=snippet,statistics`. Mock path returns the same
   * deterministic seed as the /videos endpoint so the analytics view is
   * populated end-to-end without real credentials.
   */
  listRecentVideos?(accessToken: string, channelId: string, maxResults?: number): Promise<VideoStats[]>;
}
