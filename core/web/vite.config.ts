import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// process.env in a Vite config file does NOT include .env files — they
// only reach client code via import.meta.env. loadEnv() reads .env.local
// etc. so VITE_API_TARGET here actually honors the project's env file;
// without it the proxy silently falls back to a dead port and every
// /api + /auth request through the dev server 500s.
const fileEnv = loadEnv(process.env['NODE_ENV'] || 'development', __dirname, '');
const apiTarget =
  process.env['VITE_API_TARGET'] || fileEnv['VITE_API_TARGET'] || 'http://localhost:5182';

// Proxy two path prefixes to the API server:
//   /api/*  → API as /api/<path> with the `/api` prefix stripped. All
//             React code that talks to the API uses `BASE = '/api'` from
//             src/lib/api.ts.
//   /auth/* → API as /auth/<path> (no rewrite). The web triggers OAuth by
//             redirecting to `/api/auth/<platform>/start`, and the OAuth
//             callback (`/auth/callback?code=…`) is part of that same
//             prefix — both must round-trip through the API.
//
// Both proxies set `changeOrigin: true` (Fastify behind a proxy expects
// the upstream host) AND inject `X-Forwarded-Host` so the API can derive
// the original browser origin. Without that header, OAuth callbacks
// would redirect straight to localhost:3000 and bypass the Vite proxy on
// full-page navigation.
//
// React Router paths (src/main.tsx) are /, /upload, /schedule, /history,
// /accounts, /analytics. None overlap with /api or /auth, so the proxies
// are safe. Reload on any route returns the SPA HTML shell, and OAuth
// flows always land back on the API.
function forwardToApi(opts: { stripApiPrefix?: boolean } = {}) {
  return {
    target: apiTarget,
    changeOrigin: true,
    // We deliberately do NOT inject X-Forwarded-Host here. The API
    // derives its OAuth callback origin from WEB_ORIGIN (env) rather
    // than a client-supplied header — that closes the host-header
    // injection vector where a malicious client could force the
    // redirect_uri to a domain they control and silently exfil OAuth
    // tokens. Set WEB_ORIGIN to the public URL (e.g. http://localhost:5273
    // in dev) so it matches the browser's host.
    ...(opts.stripApiPrefix
      ? { rewrite: (path: string) => path.replace(/^\/api/, '') }
      : {}),
  };
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number.parseInt(process.env['VITE_WEB_PORT'] || '5173', 10),
    strictPort: true,
    proxy: {
      '/api': forwardToApi({ stripApiPrefix: true }),
      '/auth': forwardToApi(),
    },
  },
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
  },
});
