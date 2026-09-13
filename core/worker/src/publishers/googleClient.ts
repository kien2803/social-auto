import { google } from 'googleapis';
import type { ChannelInfo, GoogleOAuthClient, GoogleTokens } from './googleClientTypes.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

export interface RealGoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createGoogleClient(config: RealGoogleConfig): GoogleOAuthClient {
  const oauth2 = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
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
      return {
        access_token: tokens.access_token,
        expires_at: tokens.expiry_date ?? Date.now() + 3600_000,
        refresh_token: tokens.refresh_token ?? null,
        scope: tokens.scope ?? SCOPES.join(' '),
        token_type: tokens.token_type ?? 'Bearer',
      };
    },
    async refresh(refreshToken: string): Promise<GoogleTokens> {
      oauth2.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2.refreshAccessToken();
      if (!credentials.access_token) throw new Error('No access_token in refresh response');
      return {
        access_token: credentials.access_token,
        expires_at: credentials.expiry_date ?? Date.now() + 3600_000,
        refresh_token: credentials.refresh_token ?? refreshToken,
        scope: credentials.scope ?? SCOPES.join(' '),
        token_type: credentials.token_type ?? 'Bearer',
      };
    },
    async getMyChannel(accessToken: string): Promise<ChannelInfo> {
      oauth2.setCredentials({ access_token: accessToken });
      const youtube = google.youtube({ version: 'v3', auth: oauth2 });
      const res = await youtube.channels.list({ part: ['snippet'], mine: true });
      const first = res.data.items?.[0];
      if (!first?.id) throw new Error('No channel found');
      return {
        id: first.id,
        title: first.snippet?.title ?? 'Unknown',
        thumbnail_url: first.snippet?.thumbnails?.default?.url ?? undefined,
      };
    },
  };
}
