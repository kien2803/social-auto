/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initSentry, captureException } from './sentry.js';
import { env } from './env.js';
import { openDB } from './db.js';
import { AccountsRepo } from './repositories/accounts.js';
import { VideosRepo } from './repositories/videos.js';
import { ScheduledPostsRepo } from './repositories/scheduledPosts.js';
import { QuotasRepo } from './repositories/quotas.js';
import { UsersRepo } from './repositories/users.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerUserAuthRoutes } from './routes/userAuth.js';
import { registerVideoRoutes } from './routes/videos.js';
import { registerScheduleRoutes } from './routes/schedule.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerQuotaRoutes } from './routes/quota.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerStorageRoutes } from './routes/storage.js';
import { registerUploadProgressRoutes, updateProgress } from './routes/uploadProgress.js';
import { StorageManager } from './services/storageManager.js';
import { createStorageBackend } from '@social-auto/shared/storage';
import { AuthService } from './services/authService.js';
import { createGoogleClient } from './google/factory.js';
import { createTiktokClient } from './tiktok/factory.js';
import { createMetaClient } from './meta/factory.js';
import { registerPopupCloseRoute } from './auth/popupClose.js';
import { migrateAvatars } from './migrations/avatarMigration.js';
import { createAuthMiddleware } from './middleware/auth.js';

export async function buildApp() {
  // Initialize Sentry error tracking
  initSentry();

  const app = Fastify({
    logger: true,
    // Behind a reverse proxy (the documented production topology) every
    // client shares the proxy's socket address. trustProxy makes
    // request.ip read X-Forwarded-For so per-IP rate limiting actually
    // distinguishes users instead of rate-limiting the whole deployment.
    trustProxy: true,
    // Single-origin deploys serve the SPA and the API on one port. The web
    // app always prefixes API calls with /api — strip it so the same route
    // tree answers. Dev is unaffected: the Vite proxy strips it upstream.
    // Browser navigations (Accept: text/html GETs outside /auth) are routed
    // to '/' so the SPA shell is served; XHRs carry non-HTML Accept headers
    // and continue into the API routes unchanged.
    rewriteUrl: (req) => {
      let url = req.url ?? '/';
      if (/^\/api(?=\/|$)/.test(url)) url = url.slice(4) || '/';
      const accept = req.headers?.accept ?? '';
      if (
        req.method === 'GET' &&
        accept.includes('text/html') &&
        !/^\/(auth|health)(\/|$|\?)/.test(url)
      ) {
        return '/';
      }
      return url;
    },
  });
  
  // Add Sentry error handler if enabled
  if (process.env['SENTRY_DSN']) {
    app.setErrorHandler((error, request, reply) => {
      // Capture exception with Sentry
      captureException(error, {
        url: request.url,
        method: request.method,
        headers: request.headers,
      });
      const statusCode = error.statusCode ?? 500;
      // 4xx messages are client-facing contract; 5xx messages may carry
      // internals (SQL errors, file paths) — don't echo them to the client.
      reply.code(statusCode).send({
        statusCode,
        error: statusCode >= 500 ? 'Internal Server Error' : error.name,
        message: statusCode >= 500 ? 'An unexpected error occurred' : error.message,
      });
    });
  }
  
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
  const users = new UsersRepo(db);
  const authService = new AuthService(users, env.jwtSecret);
  const authMiddleware = createAuthMiddleware(authService, true);
  const optionalAuthMiddleware = createAuthMiddleware(authService, false);

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
  registerHealthRoutes(app, { posts, accounts, optionalAuthMiddleware });
  registerQuotaRoutes(app, { quotas, authMiddleware });
  registerUserAuthRoutes(app, { authService, authMiddleware });
  // Mount the legacy IG/FB mock OAuth routes when EITHER:
  //   - USE_MOCK_PUBLISHERS=true (worker's stub publishers are in use), or
  //   - Meta credentials are missing (factory falls back to mock).
  // The meta factory's auto-fallback already returns a mock client when
  // META_APP_ID/SECRET/REDIRECT_URI are empty, so syncing the legacy
  // route mount with that gives the SPA a working "Connect Instagram"
  // button out of the box (inserts a mock-ig-prefixed row that the
  // worker's stubUpload validators accept).
  const metaUseMock = !env.metaAppId || !env.metaAppSecret || !env.metaRedirectUri;
  const tiktokUseMock = !env.tiktokClientKey || !env.tiktokClientSecret || !env.tiktokRedirectUri;

  registerAuthRoutes(app, {
    accounts,
    google,
    tiktok: tiktokUseMock ? undefined : tiktok,
    meta: metaUseMock ? undefined : meta,
    webOrigin: env.webOrigin,
    tokenEncryptionKey: env.tokenEncryptionKey,
    useMockPublishers: env.useMockPublishers || metaUseMock,
    mockTiktok: tiktokUseMock,
    authMiddleware,
    optionalAuthMiddleware,
  });
  registerAccountRoutes(app, { accounts, posts, google, tokenEncryptionKey: env.tokenEncryptionKey, authMiddleware });
  registerVideoRoutes(app, { videos, posts, storageDir: env.storageDir, authMiddleware });
  registerScheduleRoutes(app, { posts, videos, accounts, authMiddleware });
  registerUploadProgressRoutes(app, { authMiddleware, videos });
  const backend = createStorageBackend({
    type: env.storageType,
    local: env.storageType === 'local' ? { baseDir: env.storageDir } : undefined,
    s3:
      env.storageType === 'local'
        ? undefined
        : {
            region: env.awsRegion,
            endpoint: env.awsEndpoint || undefined,
            accessKeyId: env.awsAccessKeyId,
            secretAccessKey: env.awsSecretAccessKey,
            bucket: env.awsS3Bucket,
            prefix: env.awsS3Prefix,
            forcePathStyle: env.awsForcePathStyle || env.storageType === 'r2',
          },
    quota: {
      maxBytes: env.storageQuotaGB * 1024 * 1024 * 1024,
      enforceQuota: env.storageEnforceQuota,
    },
  });
  // StorageManager speaks an older get/put-style backend interface; adapt
  // the shared backend (upload/download) and forward the optional helpers
  // it probes via `as any` (baseDir, markFile*, checkDiskSpace).
  const storageAdapter = {
      type: backend.type,
      baseDir: env.storageDir,
      initialize: () => backend.initialize(),
      getUsage: (p: string) => backend.getUsage(p),
      list: async (p: string, limit: number) =>
        (await backend.list(p, limit)).map((i) => ({
          key: i.key,
          isDirectory: i.isDirectory,
          lastModified: i.lastModified,
        })),
      get: (key: string) => backend.download(key),
      put: async (key: string, data: Buffer) => {
        await backend.upload(data, key);
      },
      delete: (key: string) => backend.delete(key),
      markFileUploading: (backend as any).markFileUploading?.bind(backend),
      markFileComplete: (backend as any).markFileComplete?.bind(backend),
      checkDiskSpace: (backend as any).checkDiskSpace?.bind(backend),
  };
  const storageManager = new StorageManager(storageAdapter, videos, env.storageQuotaGB);
  registerStorageRoutes(app, { storageManager, authMiddleware });

  // Production single-origin: serve the built SPA when a dist bundle exists.
  // The rewriteUrl hook above already mapped browser navigations to '/', so
  // the static plugin serves index.html for them; unknown non-HTML GETs fall
  // through to the notFound handler below. In dev (no dist) nothing changes.
  if (existsSync(env.webDistDir)) {
    await app.register(fastifyStatic, { root: env.webDistDir });
    app.setNotFoundHandler((req, reply) => {
      const accept = req.headers.accept ?? '';
      if (req.method === 'GET' && accept.includes('text/html')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`,
      });
    });
  }

  // Single-process deploys (Docker image, `pnpm start` with
  // EMBEDDED_WORKER=true) run the publisher in-process sharing this DB
  // handle — that removes the last sql.js cross-process file race
  // entirely. Dynamic, non-literal import so the worker's TS source stays
  // out of this package's tsconfig program (tsx resolves it at runtime).
  if (env.embeddedWorker) {
    const workerEntry = new URL('../../worker/src/index.js', import.meta.url).href;
    const { startEmbeddedWorker } = (await import(workerEntry)) as {
      startEmbeddedWorker: (
        db: unknown,
        opts?: { onUploadProgress?: (videoId: string, progress: number) => void },
      ) => { stop(): void };
    };
    const worker = startEmbeddedWorker(db, {
      // The worker shares this process, so its upload-progress callbacks can
      // write the same progressCache the /videos/:id/progress routes read.
      // In standalone-worker mode there is no shared cache — the endpoints
      // simply report 404, same as before.
      onUploadProgress: updateProgress,
    });
    app.addHook('onClose', async () => {
      worker.stop();
    });
    app.log.info('embedded worker started (EMBEDDED_WORKER=true)');
  }
  return app;
}
const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const app = await buildApp();
  // Graceful shutdown: Docker / systemd send SIGTERM; closing the server
  // runs onClose hooks (embedded worker stop flag) before exit.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
  app.listen({ host: env.apiHost, port: env.apiPort }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}