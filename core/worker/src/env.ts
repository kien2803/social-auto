import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Same repo-root anchoring as core/api/src/env.ts. Anchoring relative
// paths to the repo root keeps the worker pointed at the canonical
// storage/ regardless of which package started it (tsx, pm2, tests).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Same fix as core/api/src/env.ts — always load .env.local with
// override=false so non-secret values (USE_MOCK_PUBLISHERS, *_REDIRECT_URI)
// land even when TOKEN_ENCRYPTION_KEY was set by the launcher.
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
 * Worker only needs Google creds for the YouTube publisher's refresh path.
 * Real OAuth requires them; mock publishers (USE_MOCK_PUBLISHERS=true) and
 * non-YouTube platforms in mock mode can run with empty strings — the
 * worker skips Google refresh in those branches.
 */
function optGoogleCred(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env['USE_MOCK_PUBLISHERS'] === 'true' || process.env['USE_MOCK_GOOGLE'] === 'true')
    return '';
  throw new Error(
    `Missing required env var: ${name} (set USE_MOCK_PUBLISHERS=true for local dev, ` +
      `or fill in ${name} per plans/core/phase-0-bootstrap/google-cloud-setup.md)`,
  );
}

function stripFileScheme(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}



export const env = {
  databaseUrl: stripFileScheme(repoPath(opt('DATABASE_URL', './storage/app.db'))),
  storageDir: repoPath(opt('STORAGE_DIR', './storage')),
  storageType: opt('STORAGE_TYPE', 'local') as 'local' | 's3' | 'r2',
  storageQuotaGB: Number.parseInt(opt('STORAGE_QUOTA_GB', '10'), 10),
  storageEnforceQuota: opt('STORAGE_ENFORCE_QUOTA', 'true') === 'true',
  awsRegion: opt('AWS_REGION', 'us-east-1'),
  awsEndpoint: opt('AWS_ENDPOINT', ''),
  awsAccessKeyId: opt('AWS_ACCESS_KEY_ID', ''),
  awsSecretAccessKey: opt('AWS_SECRET_ACCESS_KEY', ''),
  awsS3Bucket: opt('AWS_S3_BUCKET', ''),
  awsS3Prefix: opt('AWS_S3_PREFIX', ''),
  awsForcePathStyle: opt('AWS_FORCE_PATH_STYLE', 'false') === 'true',
  clientId: optGoogleCred('GOOGLE_CLIENT_ID'),
  clientSecret: optGoogleCred('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: opt('GOOGLE_REDIRECT_URI', 'http://localhost:3000/auth/callback'),
  tokenEncryptionKey: req('TOKEN_ENCRYPTION_KEY'),
  useMockPublishers: opt('USE_MOCK_PUBLISHERS', 'false') === 'true',
  tiktokClientKey: opt('TIKTOK_CLIENT_KEY', ''),
  metaAppId: opt('META_APP_ID', ''),
  apiPort: opt('API_PORT', '5182'),
};

