/**
 * Minimal Google OAuth client interface — mirrored from apps/api. Phase 3+ should
 * lift this into @social-auto/google-client.
 */

export interface GoogleTokens {
  access_token: string;
  expires_at: number;
  refresh_token: string | null;
  scope: string;
  token_type: string;
}

export interface ChannelInfo {
  id: string;
  title: string;
  thumbnail_url?: string;
}

export interface GoogleOAuthClient {
  buildAuthUrl(state: string, redirectUri?: string): string;
  exchangeCode(code: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  getMyChannel(accessToken: string): Promise<ChannelInfo>;
}
