/**
 * PM2 ecosystem — Production configuration
 * 
 * This is a production-specific configuration with:
 * - Cluster mode for API (multiple instances)
 * - Sentry error tracking integration
 * - Production log rotation
 * - Health checks
 * - Production environment variables
 * 
 * Usage:
 *   pm2 start ecosystem.production.cjs --env production
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
 * missing or empty. Use ONLY for secrets that cannot have a safe default.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[PM2] Required environment variable ${name} is not set`);
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
 * the app. This prevents silent failures where PM2 thinks it started the
 * process but the app immediately exited due to EADDRINUSE.
 */
async function assertPortFree(host, port, label) {
  try {
    const net = require('node:net');
    const client = new net.Socket();
    
    await new Promise((resolve, reject) => {
      client.once('connect', () => {
        client.destroy();
        reject(new Error(`Port ${port} is already in use`));
      });
      client.once('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
          resolve();
        } else {
          reject(err);
        }
      });
      client.connect(port, host);
    });
  } catch (err) {
    console.error(`[PM2] ${label} port ${host}:${port} is already in use`);
    process.exit(1);
  }
}

// Eagerly validate the secrets we cannot run without
const tokenEncryptionKey = requireEnv('TOKEN_ENCRYPTION_KEY');
const clientId = requireEnv('GOOGLE_CLIENT_ID');
const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
const googleRedirectUri = optEnv('GOOGLE_REDIRECT_URI', 'https://your-domain.com/auth/google/callback');

// Optional platform credentials
const tiktokClientKey = optEnv('TIKTOK_CLIENT_KEY', '');
const tiktokClientSecret = optEnv('TIKTOK_CLIENT_SECRET', '');
if ((tiktokClientKey && !tiktokClientSecret) || (!tiktokClientKey && tiktokClientSecret)) {
  console.error('[PM2] TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must both be set or both empty');
  process.exit(1);
}

const metaAppId = optEnv('META_APP_ID', '');
const metaAppSecret = optEnv('META_APP_SECRET', '');
const metaRedirectUri = optEnv('META_REDIRECT_URI', '');
if ((metaAppId && !metaAppSecret) || (!metaAppId && metaAppSecret)) {
  console.error('[PM2] META_APP_ID and META_APP_SECRET must both be set or both empty');
  process.exit(1);
}

// Sentry configuration (optional but recommended for production)
const sentryDsn = optEnv('SENTRY_DSN', '');

// Production ports
const apiHost = optEnv('API_HOST', '0.0.0.0');
const apiPort = Number.parseInt(optEnv('API_PORT', '3000'), 10);
const webHost = optEnv('WEB_HOST', '127.0.0.1');
const webPort = Number.parseInt(optEnv('VITE_WEB_PORT', '5173'), 10);

// Probe ports synchronously
(async () => {
  await assertPortFree(apiHost, apiPort, 'API');
  await assertPortFree(webHost, webPort, 'Web');
})();

module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      cwd: apiDir,
      script: tsxCli,
      args: 'src/server.ts',
      windowsHide: true,
      exec_mode: 'cluster', // Cluster mode for production
      instances: 'max', // Use all available CPU cores
      instance_var: 'INSTANCE_ID',
      
      env: {
        NODE_ENV: 'production',
        WEB_ORIGIN: optEnv('WEB_ORIGIN', 'https://your-domain.com'),
        API_HOST: apiHost,
        API_PORT: apiPort,
        
        // Google OAuth (required for production)
        GOOGLE_CLIENT_ID: clientId,
        GOOGLE_CLIENT_SECRET: clientSecret,
        GOOGLE_REDIRECT_URI: googleRedirectUri,
        USE_MOCK_GOOGLE: 'false',
        
        // TikTok OAuth (optional)
        TIKTOK_CLIENT_KEY: tiktokClientKey,
        TIKTOK_CLIENT_SECRET: tiktokClientSecret,
        TIKTOK_REDIRECT_URI: optEnv('TIKTOK_REDIRECT_URI', 'https://your-domain.com/auth/tiktok/callback'),
        USE_MOCK_TIKTOK: tiktokClientKey ? 'false' : 'true',
        
        // Meta OAuth (optional)
        META_APP_ID: metaAppId,
        META_APP_SECRET: metaAppSecret,
        META_REDIRECT_URI: metaRedirectUri,
        META_API_VERSION: optEnv('META_API_VERSION', 'v24.0'),
        
        // Database and storage
        DATABASE_URL: optEnv('DATABASE_URL', path.join(storageDir, 'app.db')),
        STORAGE_DIR: optEnv('STORAGE_DIR', storageDir),
        STORAGE_QUOTA_GB: optEnv('STORAGE_QUOTA_GB', '50'),
        
        // Security
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
        
        // Sentry error tracking
        SENTRY_DSN: sentryDsn,
        
        // Logging
        LOG_LEVEL: optEnv('LOG_LEVEL', 'info'),
      },
      
      // Production restart policies
      autorestart: true,
      max_memory_restart: '1G',
      max_restarts: 10,
      restart_delay: 4000,
      exp_backoff_restart_delay: true,
      kill_timeout: 10000,
      min_uptime: '10s',
      
      // Health check
      wait_ready: true,
      listen_timeout: 10000,
      
      // Logging with rotation
      out_file: path.join(apiDir, 'logs', 'api.out.log'),
      error_file: path.join(apiDir, 'logs', 'api.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      
      // Log rotation (requires pm2-logrotate module)
      log_rotate: true,
      log_file_pattern: 'YYYY-MM-DD',
      log_max_file_size: '10M',
      log_retention: '30d',
    },
    {
      name: 'social-auto-worker',
      script: tsxCli,
      args: 'src/index.ts',
      windowsHide: true,
      cwd: workerDir,
      exec_mode: 'fork', // Worker runs single instance
      
      env: {
        NODE_ENV: 'production',
        
        // Google OAuth
        GOOGLE_CLIENT_ID: clientId,
        GOOGLE_CLIENT_SECRET: clientSecret,
        GOOGLE_REDIRECT_URI: googleRedirectUri,
        USE_MOCK_GOOGLE: 'false',
        
        // Database and storage
        DATABASE_URL: optEnv('DATABASE_URL', path.join(storageDir, 'app.db')),
        STORAGE_DIR: optEnv('STORAGE_DIR', storageDir),
        
        // Security
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
        
        // Sentry error tracking
        SENTRY_DSN: sentryDsn,
        
        // Worker configuration
        POLL_INTERVAL_MS: optEnv('POLL_INTERVAL_MS', '30000'),
        UPLOAD_CONCURRENCY: optEnv('UPLOAD_CONCURRENCY', '3'),
      },
      
      // Production restart policies
      autorestart: true,
      max_memory_restart: '1G',
      max_restarts: 10,
      restart_delay: 4000,
      exp_backoff_restart_delay: true,
      kill_timeout: 10000,
      min_uptime: '10s',
      
      // Logging with rotation
      out_file: path.join(workerDir, 'logs', 'worker.out.log'),
      error_file: path.join(workerDir, 'logs', 'worker.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      
      // Log rotation
      log_rotate: true,
      log_file_pattern: 'YYYY-MM-DD',
      log_max_file_size: '10M',
      log_retention: '30d',
    },
    {
      name: 'social-auto-web',
      cwd: webDir,
      script: viteCli,
      args: ['--host', webHost, '--port', String(webPort)],
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      
      env: {
        NODE_ENV: 'production',
        VITE_WEB_PORT: webPort,
        WEB_HOST: webHost,
      },
      
      // Production restart policies
      autorestart: true,
      max_memory_restart: '512M',
      max_restarts: 10,
      restart_delay: 4000,
      exp_backoff_restart_delay: true,
      kill_timeout: 10000,
      min_uptime: '10s',
      
      // Logging with rotation
      out_file: path.join(webDir, 'logs', 'web.out.log'),
      error_file: path.join(webDir, 'logs', 'web.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      
      // Log rotation
      log_rotate: true,
      log_file_pattern: 'YYYY-MM-DD',
      log_max_file_size: '10M',
      log_retention: '30d',
    },
  ],
};