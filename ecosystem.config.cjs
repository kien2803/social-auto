/**
 * PM2 ecosystem — runs api + worker + web as separate processes.
 *
 * Usage:
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup   (auto-start on boot; Windows: run the printed command as Administrator)
 *
 * For Windows auto-start, `node-windows` is an alternative — install when needed:
 *   pnpm add -D node-windows
 *
 * Each entry uses an explicit `interpreter` (full path to node + tsx script) so
 * pm2 doesn't have to search PATH for `tsx`. The web entry invokes Vite's CLI
 * directly with node. All three share the same DB path under `../../storage`.
 *
 * Secrets policy: this file MUST NOT contain real OAuth client secrets or
 * production encryption keys. Read them from the environment at boot and
 * fail-fast if a required secret is missing — never fall back to a baked-in
 * default. Set these in `ecosystem.secrets.cjs` (gitignored) or in your
 * orchestrator's secret store and source them before `pm2 start`.
 */
const path = require('node:path');
const repoRoot = __dirname;
const apiDir = path.join(repoRoot, 'core', 'api');
const workerDir = path.join(repoRoot, 'core', 'worker');
const webDir = path.join(repoRoot, 'core', 'web');
const tsxCli = path.join(repoRoot, 'node_modules', '.pnpm', 'tsx@4.23.13', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = path.join(webDir, 'node_modules', 'vite', 'bin', 'vite.js');
const storageDir = path.join(repoRoot, 'storage');

/**
 * Pull a required secret from `process.env` and exit the process if it's
 * missing. PM2 captures the exit and will surface the missing-var name in
 * the process log, which is the failure mode we want at deploy time —
 * silent fallbacks to a baked-in key have already leaked in the past.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    console.error(`[ecosystem] required env var missing: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Optional env var with a literal default. Use ONLY for non-secret config
 * such as URLs and feature flags. NEVER default a secret here.
 */
function optEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

/**
 * Try to detect whether `host:port` is already bound before PM2 launches
 * the app. PM2 will happily schedule a process whose port is held by
 * another tool, then crash-loop with EADDRINUSE — much noisier than
 * failing fast here. We probe with a single TCP connect; if anything is
 * listening, exit so the operator gets a clear "port already in use"
 * message instead of a flood of PM2 restart attempts.
 *
 * INFRA-008: bound restart policy + safe port preflight.
 */
function assertPortFree(host, port, label) {
  const net = require('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(err);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(new Error(`${label} port ${host}:${port} is already in use`)));
    socket.once('timeout', () => done(new Error(`${label} port ${host}:${port} probe timed out`)));
    socket.once('error', (err) => {
      // ECONNREFUSED → nothing listening; that is the "free" outcome.
      if (err && err.code === 'ECONNREFUSED') done(null);
      else done(null);
    });
    try {
      socket.connect(port, host);
    } catch {
      done(null);
    }
  });
}


// Eagerly validate the secrets we cannot run without. PM2 evaluates the
// config file synchronously, so exiting here aborts `pm2 start` before
// any worker is launched.
const tokenEncryptionKey = requireEnv('TOKEN_ENCRYPTION_KEY');
const tiktokClientKey = optEnv('TIKTOK_CLIENT_KEY', '');
const tiktokClientSecret = optEnv('TIKTOK_CLIENT_SECRET', '');
if ((tiktokClientKey && !tiktokClientSecret) || (!tiktokClientKey && tiktokClientSecret)) {
  console.error('[ecosystem] TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must both be set or both be empty');
  process.exit(1);
}

// Resolve ports the apps will bind to. Default to the well-known dev ports
// (API 3000, web 5173); honor API_HOST / API_PORT / VITE_WEB_PORT overrides
// if the operator has set them in their environment.
const apiHost = optEnv('API_HOST', '0.0.0.0');
const apiPort = Number.parseInt(optEnv('API_PORT', '3000'), 10);
const webHost = optEnv('WEB_HOST', '127.0.0.1');
const webPort = Number.parseInt(optEnv('VITE_WEB_PORT', '5173'), 10);

// Probe ports synchronously by running a short async chain. PM2 requires
// `module.exports` to be set, but it does not inspect it until after this
// file finishes evaluating — so we can do async work here and still halt
// the launch with `process.exit(1)` if a port is busy.
(async () => {
  const checks = [
    assertPortFree(apiHost, apiPort, 'api'),
    assertPortFree(webHost, webPort, 'web'),
  ];
  const results = await Promise.all(checks);
  const conflict = results.find((err) => err);
  if (conflict) {
    console.error(`[ecosystem] port preflight failed: ${conflict.message}`);
    console.error('[ecosystem] stop the conflicting process or change API_PORT / VITE_WEB_PORT');
    process.exit(1);
  }
})();

module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      cwd: apiDir,
      script: tsxCli,
      args: 'src/server.ts',
      windowsHide: true,

      env: {
        NODE_ENV: 'production',
        WEB_ORIGIN: optEnv('WEB_ORIGIN', 'http://localhost:5173'),
        // Mock flags default ON so dev installs boot without per-platform
        // OAuth credentials. Flip to 'false' AND supply real credentials
        // before going live.
        USE_MOCK_TIKTOK: optEnv('USE_MOCK_TIKTOK', 'true'),
        TIKTOK_CLIENT_KEY: tiktokClientKey,
        TIKTOK_CLIENT_SECRET: tiktokClientSecret,
        TIKTOK_REDIRECT_URI: optEnv('TIKTOK_REDIRECT_URI', 'http://localhost:3000/auth/tiktok/callback'),
        USE_MOCK_GOOGLE: optEnv('USE_MOCK_GOOGLE', 'true'),
        USE_MOCK_PUBLISHERS: optEnv('USE_MOCK_PUBLISHERS', 'true'),
        DATABASE_URL: optEnv('DATABASE_URL', path.join(storageDir, 'app.db')),
        STORAGE_DIR: optEnv('STORAGE_DIR', storageDir),
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      // PM2 restart hygiene (INFRA-008): bound the restart loop so a
      // crash-loop (e.g. missing secret detected mid-start) surfaces as
      // a stopped process instead of a flood of autorestart noise.
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: true,
      kill_timeout: 5000,
      wait_ready: false,
      out_file: path.join(apiDir, 'logs', 'api.out.log'),
      error_file: path.join(apiDir, 'logs', 'api.err.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'social-auto-worker',
      script: tsxCli,
      args: 'src/index.ts',
      windowsHide: true,
      cwd: workerDir,

      env: {
        NODE_ENV: 'production',
        USE_MOCK_GOOGLE: optEnv('USE_MOCK_GOOGLE', 'true'),
        USE_MOCK_PUBLISHERS: optEnv('USE_MOCK_PUBLISHERS', 'true'),
        DATABASE_URL: optEnv('DATABASE_URL', path.join(storageDir, 'app.db')),
        STORAGE_DIR: optEnv('STORAGE_DIR', storageDir),
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: true,
      kill_timeout: 5000,
      out_file: path.join(workerDir, 'logs', 'worker.out.log'),
      error_file: path.join(workerDir, 'logs', 'worker.err.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'social-auto-web',
      cwd: webDir,
      script: viteCli,
      args: '--host',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: true,
      out_file: path.join(webDir, 'logs', 'web.out.log'),
      error_file: path.join(webDir, 'logs', 'web.err.log'),
      merge_logs: true,
      time: true,
    },
  ],
};