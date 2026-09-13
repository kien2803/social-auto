import { createMockMetaClient, type MockMetaConfig } from './mockClient.js';
import { createRealMetaClient, type RealMetaConfig } from './realClient.js';
import type { MetaOAuthClient } from './client.js';

export interface MetaClientConfig {
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  apiVersion?: string;
  forceMock?: boolean;
  mockConfig?: MockMetaConfig;
  fetchImpl?: typeof fetch;
}

export function createMetaClient(config: MetaClientConfig): MetaOAuthClient {
  const useMock =
    config.forceMock === true ||
    process.env['USE_MOCK_META'] === 'true' ||
    !config.appId ||
    !config.appSecret ||
    !config.redirectUri;
  if (useMock) {
    return createMockMetaClient(config.mockConfig);
  }
  const real: RealMetaConfig = {
    appId: config.appId!,
    appSecret: config.appSecret!,
    redirectUri: config.redirectUri!,
  };
  if (config.apiVersion) real.apiVersion = config.apiVersion;
  if (config.fetchImpl) real.fetchImpl = config.fetchImpl;
  return createRealMetaClient(real);
}
