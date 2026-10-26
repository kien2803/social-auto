-- Consolidated final schema for D1 (matches post-migration shape of the
-- sql.js app — same tables, same columns, same indexes). Fresh deploys
-- apply this single file instead of replaying the 11 legacy migrations.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  oauth_refresh_token TEXT NOT NULL,
  oauth_access_token TEXT,
  token_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  content_category TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  channel_handle TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  subscribers INTEGER,
  views INTEGER,
  video_count INTEGER,
  like_count INTEGER,
  avg_watch_seconds INTEGER,
  drop_off_pct REAL,
  last_sync_at INTEGER
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_sec INTEGER,
  mime TEXT NOT NULL,
  thumbnail_path TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scheduled_at INTEGER NOT NULL,
  caption TEXT NOT NULL,
  per_platform_caption TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'pending',
  external_post_id TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  is_dead INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_pending_due
  ON scheduled_posts(scheduled_at, next_retry_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  "limit" INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (platform, window_start)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
