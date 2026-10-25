import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Walk from this source file up to the repo root. The pm2 ecosystem and
// tsx both run with cwd = the package directory (core/api), which makes
// a relative `./storage/app.db` resolve to core/api/storage/app.db — a
// stale half-migrated DB created by older launches. Anchoring relative
// paths to the repo root keeps api + worker pointed at the same canonical
// storage/ regardless of which package started them.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Load .env.local first (override=false so explicit process.env wins).
// We always load it because some values (WEB_ORIGIN, USE_MOCK_*,
// *_REDIRECT_URI) have no equivalent in the parent shell and would
// otherwise fall back to the hard-coded defaults in `opt()` below.
// Then load core/.env.local as a legacy fallback if the root file
// didn't set the encryption key.
const rootEnv = resolve(REPO_ROOT, '.env.local');
const legacyEnv = resolve(REPO_ROOT, 'core', '.env.local');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, override: false });
if (!process.env['TOKEN_ENCRYPTION_KEY'] && existsSync(legacyEnv)) {
  loadEnv({ path: legacyEnv, override: false });
}

/** Resolve a relative path against the repo root so it works regardless of cwd. */
function repoPath(value: string): string {
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}

/**
 * Required env var: throws when missing. Use for secrets that have no
 * safe placeholder (encryption keys, real OAuth credentials).
 */
function req(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * Required only when USE_MOCK_GOOGLE is not 'true'. In mock mode the
 * Google client is stubbed so real credentials are not needed — leaving
 * them blank lets fresh checkouts boot without a Google Cloud project.
 * When real mode is requested, throw early with a hint pointing at the
 * setup guide.
 */
function optGoogleCred(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env['USE_MOCK_GOOGLE'] === 'true') return '';
  throw new Error(
    `Missing required env var: ${name} (set USE_MOCK_GOOGLE=true for local dev without Google credentials, ` +
      `or fill in ${name} per plans/core/phase-0-bootstrap/google-cloud-setup.md)`,
  );
}

/**
 * Required only when USE_MOCK_TIKTOK is not 'true'. In mock mode the
 * TikTok client is stubbed so real credentials are not needed.
 */
function optTiktokCred(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env['USE_MOCK_TIKTOK'] === 'true') return '';
  throw new Error(
    `Missing required env var: ${name} (set USE_MOCK_TIKTOK=true for local dev without TikTok credentials, ` +
      `or fill in ${name} per plans/real-authentication-plan.md)`,
  );
}

/**
 * Required only when USE_MOCK_META is not 'true'. In mock mode the
 * Meta client is stubbed so real credentials are not needed.
 */
function optMetaCred(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env['USE_MOCK_META'] === 'true') return '';
  throw new Error(
    `Missing required env var: ${name} (set USE_MOCK_META=true for local dev without Meta credentials, ` +
      `or fill in ${name} per plans/real-authentication-plan.md)`,
  );
}

/** Strip "file:" URL prefix so the result is a plain filesystem path. */
function stripFileScheme(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

export const env = {
  apiHost: opt('API_HOST', '0.0.0.0'),
  apiPort: Number.parseInt(opt('API_PORT', '3000'), 10),
  webOrigin: opt('WEB_ORIGIN', 'http://localhost:5173'),
  storageDir: repoPath(opt('STORAGE_DIR', './storage')),
  storageQuotaGB: Number.parseInt(opt('STORAGE_QUOTA_GB', '10'), 10),
  storageType: opt('STORAGE_TYPE', 'local') as 'local' | 's3' | 'r2',
  storageEnforceQuota: opt('STORAGE_ENFORCE_QUOTA', 'true') === 'true',
  awsRegion: opt('AWS_REGION', 'us-east-1'),
  awsEndpoint: opt('AWS_ENDPOINT', ''),
  awsAccessKeyId: opt('AWS_ACCESS_KEY_ID', ''),
  awsSecretAccessKey: opt('AWS_SECRET_ACCESS_KEY', ''),
  awsS3Bucket: opt('AWS_S3_BUCKET', ''),
  awsS3Prefix: opt('AWS_S3_PREFIX', ''),
  awsForcePathStyle: opt('AWS_FORCE_PATH_STYLE', 'false') === 'true',
  databaseUrl: stripFileScheme(repoPath(opt('DATABASE_URL', './storage/app.db'))),
  clientId: optGoogleCred('GOOGLE_CLIENT_ID'),
  clientSecret: optGoogleCred('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: opt('GOOGLE_REDIRECT_URI', 'http://localhost:3000/auth/callback'),
  tokenEncryptionKey: req('TOKEN_ENCRYPTION_KEY'),
  jwtSecret: req('JWT_SECRET'),
  useMockGoogle: opt('USE_MOCK_GOOGLE', 'false') === 'true',
  useMockPublishers: opt('USE_MOCK_PUBLISHERS', 'false') === 'true',
  useMockTiktok: opt('USE_MOCK_TIKTOK', 'false') === 'true',
  useMockMeta: opt('USE_MOCK_META', 'false') === 'true',
  tiktokClientKey: optTiktokCred('TIKTOK_CLIENT_KEY'),
  tiktokClientSecret: optTiktokCred('TIKTOK_CLIENT_SECRET'),
  tiktokRedirectUri: opt('TIKTOK_REDIRECT_URI', 'http://localhost:3000/auth/tiktok/callback'),
  metaAppId: optMetaCred('META_APP_ID'),
  metaAppSecret: optMetaCred('META_APP_SECRET'),
  metaRedirectUri: opt('META_REDIRECT_URI', 'http://localhost:3000/auth/meta/callback'),
  metaApiVersion: opt('META_API_VERSION', 'v24.0'),
  // Single-process mode: run the publishing worker inside the API process,
  // sharing one sql.js handle (no cross-process file race). The Docker
  // image sets this; dev keeps the worker as its own process.
  embeddedWorker: opt('EMBEDDED_WORKER', 'false') === 'true',
  // Built SPA to serve when present (production single-origin deploys).
  webDistDir: repoPath(opt('WEB_DIST_DIR', './core/web/dist')),
};
