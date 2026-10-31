-- Per-user platform usage. The `quotas` table tracks the GLOBAL platform
-- cap (e.g. YouTube 10k units/day is per OAuth app, shared by everyone);
-- this table records each user's own consumption for fair-use limits,
-- plans, and per-user analytics.
CREATE TABLE IF NOT EXISTS quota_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, platform, window_start)
);
CREATE INDEX IF NOT EXISTS idx_quota_usage_window ON quota_usage(window_start);
