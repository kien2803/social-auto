/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import type { Platform } from '../types/platform.js';
import type { AccountStatus, AccountChannelSnapshot } from '../types/account.js';

export type { AccountChannelSnapshot };

/**
 * DB schema for social-auto (SQLite).
 * Defined as TS interfaces; actual tables created by apps/api via raw SQL migrations.
 *
 * Phase 0: accounts table only.
 * Phase 1: + videos, scheduled_posts.
 * Phase 3: + retry_count, next_retry_at, is_dead on scheduled_posts.
 */

export interface AccountRow {
  id: string;
  platform: Platform;
  /** Stable identifier returned by the platform (YouTube channel id, IG user id, …). Unique per platform. */
  external_id: string;
  display_name: string;
  oauth_refresh_token: string;
  oauth_access_token: string | null;
  token_expires_at: number | null;
  status: AccountStatus;
  created_at: number;
  /** User-supplied content category tag (free short text, e.g. "tech"). */
  content_category: string;
  /** Spoken language the account publishes in. ENGLISH | VIETNAMESE | ''. */
  language_code: string;
  /** Free-text purpose the user gave the account. */
  purpose: string;
  /** External link the user wants shown next to the account. */
  link: string;
  channel_handle: string;
  avatar_url: string;
  subscribers: number | null;
  views: number | null;
  video_count: number | null;
  like_count: number | null;
  avg_watch_seconds: number | null;
  drop_off_pct: number | null;
  last_sync_at: number | null;
}

export interface VideoRow {
  id: string;
  file_path: string;
  sha256: string;
  size_bytes: number;
  duration_sec: number | null;
  mime: string;
  thumbnail_path: string | null;
  created_at: number;
}

export type ScheduledPostStatus =
  | 'pending'
  | 'uploading'
  | 'published'
  | 'failed'
  | 'dead';

export type Visibility = 'public' | 'unlisted' | 'private';

export interface ScheduledPostRow {
  id: string;
  video_id: string;
  account_id: string;
  scheduled_at: number;
  caption: string;
  per_platform_caption: string | null;
  visibility: Visibility;
  status: ScheduledPostStatus;
  external_post_id: string | null;
  last_error: string | null;
  retry_count: number;
  next_retry_at: number | null;
  is_dead: boolean;
  created_at: number;
  updated_at: number;
}

export interface QuotaRow {
  id: number;
  platform: Platform;
  /** Unix ms for the start of the current quota window. */
  window_start: number;
  /** Quota units consumed in the current window. */
  used: number;
  /** Quota units allowed per window. */
  limit: number;
  updated_at: number;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
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
  video_id TEXT NOT NULL REFERENCES videos(id),
  -- CASCADE on account delete so removing a connected account also
  -- removes its scheduled posts. Without this, a DELETE /accounts/:id
  -- with pending posts fails the FK constraint and the UI surfaces a
  -- confusing 500 instead of completing the disconnect flow. Workers
  -- see fewer 'uploading' orphans, and accounts.ts:DELETE doesn't have
  -- to coordinate a two-phase teardown.
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
`;

export interface Migration {
  id: string;
  phase: string;
  statements: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001-initial-schema',
    phase: 'phase-0-bootstrap',
    statements: [],
  },
  {
    id: '0002-phase-1-quota-fk-and-indexes',
    phase: 'phase-3-polish',
    statements: [
      'ALTER TABLE scheduled_posts ADD COLUMN per_platform_caption TEXT',
      'ALTER TABLE scheduled_posts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE scheduled_posts ADD COLUMN next_retry_at INTEGER',
      'ALTER TABLE scheduled_posts ADD COLUMN is_dead INTEGER NOT NULL DEFAULT 0',
    ],
  },
  {
    id: '0003-quota-table',
    phase: 'phase-3-polish',
    statements: [],
  },
  {
    id: '0004-multi-account-external-id',
    phase: 'phase-1-youtube-mvp',
    statements: [
      'ALTER TABLE accounts ADD COLUMN external_id TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_platform_external ON accounts (platform, external_id)',
    ],
  },
  {
    id: '0005-account-metadata-and-channel-snapshot',
    phase: 'phase-1-youtube-mvp',
    statements: [
      'ALTER TABLE accounts ADD COLUMN content_category TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE accounts ADD COLUMN language_code TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE accounts ADD COLUMN purpose TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE accounts ADD COLUMN link TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE accounts ADD COLUMN channel_handle TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE accounts ADD COLUMN avatar_url TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE accounts ADD COLUMN subscribers INTEGER',
      'ALTER TABLE accounts ADD COLUMN views INTEGER',
      'ALTER TABLE accounts ADD COLUMN video_count INTEGER',
      'ALTER TABLE accounts ADD COLUMN last_sync_at INTEGER',
    ],
  },
  {
    // Phase 3 polish — extra channel metrics surfaced in the Analytics page
    // single-account view. All nullable so existing rows keep their values
    // and the UI shows "—" until the next sync populates them.
    id: '0006-analytics-channel-fields',
    phase: 'phase-3-polish',
    statements: [
      'ALTER TABLE accounts ADD COLUMN like_count INTEGER',
      'ALTER TABLE accounts ADD COLUMN avg_watch_seconds INTEGER',
      'ALTER TABLE accounts ADD COLUMN drop_off_pct REAL',
    ],
  },
  {
    // Phase 3 polish — partial index on the hot path of claimDuePosts.
    // Without this, claimDuePosts falls back to a scan over every
    // pending row whenever next_retry_at has values to compare against.
    // The partial WHERE status='pending' keeps the index tight: every
    // entry corresponds to a row the worker can actually claim.
    id: '0007-claim-pending-due-index',
    phase: 'phase-3-polish',
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_scheduled_posts_pending_due ON scheduled_posts(scheduled_at, next_retry_at) WHERE status='pending'",
    ],
  },
  {
    // Quotas were originally declared with UNIQUE(platform) (one row per
    // platform globally). The repo treats `window_start` as part of the
    // key and writes a fresh row per UTC day, which collided on day
    // boundaries. Rebuild the table so the constraint is
    // UNIQUE(platform, window_start). Keep the most-recent row per
    // platform; stale rows from prior days are discarded — they're not
    // actionable anyway (a new row will be inserted on next access).
    id: '0008-quotas-unique-per-window',
    phase: 'phase-3-polish',
    statements: [
      'CREATE TABLE IF NOT EXISTS quotas_new (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, window_start INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, "limit" INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (platform, window_start))',
      "INSERT INTO quotas_new (id, platform, window_start, used, \"limit\", updated_at) SELECT id, platform, window_start, used, \"limit\", updated_at FROM quotas WHERE id IN (SELECT MAX(id) FROM quotas GROUP BY platform)",
      'DROP TABLE quotas',
      'ALTER TABLE quotas_new RENAME TO quotas',
    ],
  },
  {
    // scheduled_posts.account_id originally had no ON DELETE rule, so
    // deleting a connected account with pending posts failed the FK
    // constraint and surfaced a 500. SQLite can't ALTER an FK in place
    // (R-15856: only the legacy ALTER TABLE RENAME + add-column paths
    // are supported), so rebuild the table with the new constraint.
    // Same-shape copy: we want every existing row preserved.
    id: '0009-scheduled-posts-account-cascade',
    phase: 'phase-3-polish',
    statements: [
      'CREATE TABLE IF NOT EXISTS scheduled_posts_new (id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id), account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, scheduled_at INTEGER NOT NULL, caption TEXT NOT NULL, per_platform_caption TEXT, visibility TEXT NOT NULL DEFAULT "private", status TEXT NOT NULL DEFAULT "pending", external_post_id TEXT, last_error TEXT, retry_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, is_dead INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
      "INSERT INTO scheduled_posts_new (id, video_id, account_id, scheduled_at, caption, per_platform_caption, visibility, status, external_post_id, last_error, retry_count, next_retry_at, is_dead, created_at, updated_at) SELECT id, video_id, account_id, scheduled_at, caption, per_platform_caption, visibility, status, external_post_id, last_error, retry_count, next_retry_at, is_dead, created_at, updated_at FROM scheduled_posts",
      'DROP TABLE scheduled_posts',
      'ALTER TABLE scheduled_posts_new RENAME TO scheduled_posts',
      // Re-create the partial index that 0007 added — DROP TABLE on the
      // old table removed its index.
      "CREATE INDEX IF NOT EXISTS idx_scheduled_posts_pending_due ON scheduled_posts(scheduled_at, next_retry_at) WHERE status='pending'",
    ],
  },
];
