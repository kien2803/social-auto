import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    // Test fixtures encrypt OAuth tokens with a deterministic 64-char hex key.
    // env.ts skips loading core/.env.local when TOKEN_ENCRYPTION_KEY is already
    // set, so propagating it here makes the test fixtures and worker use the
    // same key. Without this, vitest's per-file worker process inherits the
    // 65-char value from core/.env.local (with trailing newline) and GCM
    // decryption fails.
    env: {
      TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      USE_MOCK_GOOGLE: 'true',
      USE_MOCK_PUBLISHERS: 'true',
      DATABASE_URL: ':memory:',
      STORAGE_DIR: './storage',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    },
  },
});
