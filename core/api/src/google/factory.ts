import { createRealGoogleClient, type RealGoogleConfig } from './realClient.js';
import { createMockGoogleClient } from './mockClient.js';
import type { GoogleOAuthClient } from './client.js';

export interface GoogleClientConfig extends RealGoogleConfig {}

export function createGoogleClient(config: GoogleClientConfig): GoogleOAuthClient {
  if (process.env['USE_MOCK_GOOGLE'] === 'true') return createMockGoogleClient();
  return createRealGoogleClient(config);
}