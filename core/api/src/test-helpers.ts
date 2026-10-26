import { createMockGoogleClient, type MockGoogleConfig } from './google/mockClient.js';
import type { FastifyInstance } from 'fastify';

export interface TestApp {
  app: FastifyInstance;
}

/**
 * Build a Fastify app wired to a custom mock Google client. The same in-memory
 * DB + cookie + cors stack as `buildApp()` would build, minus the route
 * registrations callers don't need. The test app always uses:
 *   - in-memory SQLite
 *   - deterministic 32-byte encryption key
 *   - mock Google OAuth (the only path tests exercise)
 */
export async function buildTestAppWithMock(mockCfg: MockGoogleConfig = {}): Promise<TestApp> {
  // Stub env
  process.env['USE_MOCK_GOOGLE'] = 'true';
  process.env['TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(64);
  process.env['DATABASE_URL'] = ':memory:';
  process.env['STORAGE_DIR'] = './storage';
  process.env['WEB_ORIGIN'] = 'http://localhost:5173';

  const Fastify = (await import('fastify')).default;
  const cors = (await import('@fastify/cors')).default;
  const cookie = (await import('@fastify/cookie')).default;
  const { openDB } = await import('./db.js');
  const { AccountsRepo } = await import('./repositories/accounts.js');
  const { registerAuthRoutes } = await import('./routes/auth.js');

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: 'http://localhost:5173', credentials: true });
  await app.register(cookie);
  const db = await openDB(':memory:');
  const accounts = new AccountsRepo(db);
  const google = createMockGoogleClient(mockCfg);
  // 'default-user' is seeded by migration 0011 — the OAuth callback's
  // getUserId fallback references it when no auth middleware ran.

  app.get('/health', async () => ({ status: 'ok' }));
  registerAuthRoutes(app, {
    accounts,
    google,
    webOrigin: 'http://localhost:5173',
    tokenEncryptionKey: 'a'.repeat(64),
    useMockPublishers: true,
    // Required in production since /auth/*/status endpoints are scoped per
    // user. In tests every account lands on 'default-user' (the OAuth
    // callback fallback), so the mock attributes requests to it — keeping
    // the status routes' assertions meaningful.
    authMiddleware: async (req: any) => {
      req.userId = 'default-user';
    },
    // Callbacks now redirect unauthenticated hits to /login — simulate a
    // signed-in user so tests keep exercising the success path.
    optionalAuthMiddleware: async (req: any) => {
      req.userId = 'default-user';
    },
  });
  // Mount the same /auth/* orphan-cookie hook the real buildApp() uses.
  // registerAuthRoutes mounts it idempotently, so this only fills in the
  // test path that skips the real bootstrap (no worker / video routes).
  const { clearOrphanOAuthCookies } = await import('./auth/popupClose.js');
  clearOrphanOAuthCookies(app);
  app.addHook('onClose', async () => db.close());
  return { app };
}