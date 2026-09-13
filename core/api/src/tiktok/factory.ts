import { createMockTiktokClient, type MockTiktokConfig } from './mockClient.js';
import { createRealTiktokClient, type RealTiktokConfig } from './realClient.js';
import type { TiktokOAuthClient } from './client.js';

export interface TiktokClientConfig {
  clientKey?: string;
  clientSecret?: string;
  redirectUri?: string;
  /** Force the mock client even when real creds are present (for tests). */
  forceMock?: boolean;
  /** Extra mock config (channels, fail flags). */
  mockConfig?: MockTiktokConfig;
  /** Optional fetch override passed through to the real client. */
  fetchImpl?: typeof fetch;
}

export function createTiktokClient(config: TiktokClientConfig): TiktokOAuthClient {
  const useMock =
    config.forceMock === true ||
    process.env['USE_MOCK_TIKTOK'] === 'true' ||
    !config.clientKey ||
    !config.clientSecret ||
    !config.redirectUri;
  if (useMock) {
    return createMockTiktokClient(config.mockConfig);
  }
  const real: RealTiktokConfig = {
    clientKey: config.clientKey!,
    clientSecret: config.clientSecret!,
    redirectUri: config.redirectUri!,
  };
  if (config.fetchImpl) real.fetchImpl = config.fetchImpl;
  return createRealTiktokClient(real);
}
