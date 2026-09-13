import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env.js';
import { openDB } from './db.js';
import { AccountsRepo } from './repositories/accounts.js';
import { VideosRepo } from './repositories/videos.js';
import { ScheduledPostsRepo } from './repositories/scheduledPosts.js';
import { QuotasRepo } from './repositories/quotas.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerVideoRoutes } from './routes/videos.js';
import { registerScheduleRoutes } from './routes/schedule.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerQuotaRoutes } from './routes/quota.js';
import { registerHealthRoutes } from './routes/health.js';
import { createGoogleClient } from './google/factory.js';
import { createTiktokClient } from './tiktok/factory.js';
import { createMetaClient } from './meta/factory.js';
import { registerTiktokAuthRoutes } from './tiktok/authRoutes.js';
import { registerMetaAuthRoutes } from './meta/authRoutes.js';
import { registerPopupCloseRoute } from './auth/popupClose.js';
import { migrateAvatars } from './migrations/avatarMigration.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
  });

  await app.register(cookie);
  const db = await openDB(env.databaseUrl);

  // Pick up writes the worker process made since we last served a request.
  // Without this hook, the API's in-memory view stays stale until a write of
  // its own bumps the mtime — see core/worker/src/db.ts for the symmetric
  // worker-side change.
  // Note: refreshIfChanged now has built-in throttling (1 second) to avoid
  // excessive filesystem checks on high-traffic endpoints like /health.
  app.addHook('onRequest', async () => {
    db.refreshIfChanged();
  });

  const accounts = new AccountsRepo(db);
  const videos = new VideosRepo(db);
  const posts = new ScheduledPostsRepo(db);
  const quotas = new QuotasRepo(db);

  const google = createGoogleClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.googleRedirectUri,
  });

  // One-shot: refresh avatar_url for YouTube accounts whose avatar was
  // captured by the pre-high-resolution thumbnail reader. Fire-and-forget
  // so it doesn't delay boot — failures are logged per-account.
  void migrateAvatars({
    accounts,
    google,
    tokenEncryptionKey: env.tokenEncryptionKey,
    log: app.log,
  });

  const tiktok = createTiktokClient({
    clientKey: env.tiktokClientKey,
    clientSecret: env.tiktokClientSecret,
    redirectUri: env.tiktokRedirectUri,
  });

  const meta = createMetaClient({
    appId: env.metaAppId,
    appSecret: env.metaAppSecret,
    redirectUri: env.metaRedirectUri,
    apiVersion: env.metaApiVersion,
  });

  // Phase 3 T3.6: health check returns worker-style status, account rollup,
  // and last_publish_at so a load balancer / monitor / user can verify the
  // system at a glance without scraping multiple endpoints.
  // Popup-mode OAuth close page. Mounted before the auth start handlers
  // so a stray /auth/popup-close request doesn't hit a wildcard.
  registerPopupCloseRoute(app);
  registerHealthRoutes(app, { posts, accounts });
  registerQuotaRoutes(app, { quotas });
  // Mount the legacy IG/FB mock OAuth routes when EITHER:
  //   - USE_MOCK_PUBLISHERS=true (worker's stub publishers are in use), or
  //   - Meta credentials are missing (factory falls back to mock).
  // The meta factory's auto-fallback already returns a mock client when
  // META_APP_ID/SECRET/REDIRECT_URI are empty, so syncing the legacy
  // route mount with that gives the SPA a working "Connect Instagram"
  // button out of the box (inserts a mock-ig-prefixed row that the
  // worker's stubUpload validators accept).
  const metaUseMock = !env.metaAppId || !env.metaAppSecret || !env.metaRedirectUri;
  registerAuthRoutes(app, {
    accounts,
    google,
    webOrigin: env.webOrigin,
    tokenEncryptionKey: env.tokenEncryptionKey,
    useMockPublishers: env.useMockPublishers || metaUseMock,
  });
  registerTiktokAuthRoutes(app, {
    accounts,
    tiktok,
    webOrigin: env.webOrigin,
    tokenEncryptionKey: env.tokenEncryptionKey,
  });
  registerMetaAuthRoutes(app, {
    accounts,
    meta,
    webOrigin: env.webOrigin,
    tokenEncryptionKey: env.tokenEncryptionKey,
  });
  registerAccountRoutes(app, { accounts, posts, google, tokenEncryptionKey: env.tokenEncryptionKey });
  registerVideoRoutes(app, { videos, storageDir: env.storageDir });
  registerScheduleRoutes(app, { posts, videos, accounts });
  return app;
}
const isMain = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`;
if (isMain) {
  const app = await buildApp();
  app.listen({ host: env.apiHost, port: env.apiPort }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

