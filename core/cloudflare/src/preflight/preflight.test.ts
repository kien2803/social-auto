import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { inspectVideo } from './inspect';
import { assessAccount } from './assess';
import { preflightRoutes } from '../routes/preflight';
import { signToken } from '../lib/jwt';
import type { Env } from '../env';
import type { AccountRow, VideoRow } from '../repos/types';

// ── fixtures ─────────────────────────────────────────────────────────────

const JWT_SECRET = 'preflight-test-secret';

function mkVideo(o: Partial<VideoRow> = {}): VideoRow {
  return {
    id: 'vid-1', user_id: 'user-1', file_path: 'videos/user-1/vid-1/clip.mp4',
    sha256: 'abc', size_bytes: 40 * 1024 * 1024, duration_sec: 30,
    mime: 'video/mp4', thumbnail_path: null, width: 1920, height: 1080,
    created_at: Date.now(), ...o,
  };
}

function mkAccount(o: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-1', user_id: 'user-1', platform: 'youtube', external_id: 'UC_x',
    display_name: 'Test Channel', oauth_refresh_token: 'rt', oauth_access_token: 'at',
    token_expires_at: Date.now() + 3600_000, status: 'active', created_at: Date.now(),
    content_category: '', language_code: '', purpose: '', link: '', channel_handle: '',
    avatar_url: '', subscribers: null, views: null, video_count: null, like_count: null,
    avg_watch_seconds: null, drop_off_pct: null, last_sync_at: null, ...o,
  };
}

function mkEnv(): Env {
  return {
    JWT_SECRET,
    META_API_VERSION: 'v24.0',
    WEB_ORIGIN: 'https://app.example',
    STORAGE: {
      head: async () => ({}),
      get: async () => ({ arrayBuffer: async () => new Uint8Array([0,0,0,1,102,116,121,112,105,115,111,109]).buffer }),
    },
  } as unknown as Env;
}

const baseInput = { caption: 'Hello world\nbody text #launch', visibility: 'private' as const };

// ── inspectVideo ─────────────────────────────────────────────────────────

describe('inspectVideo', () => {
  it('passes a well-formed mp4', () => {
    const r = inspectVideo(mkVideo(), true);
    expect(r.format).toBe('mp4');
    expect(r.aspect).toBe('16:9');
    expect(r.errors).toHaveLength(0);
  });

  it('blocks an unsupported container', () => {
    const r = inspectVideo(mkVideo({ mime: 'video/x-matroska' }), true);
    expect(r.format).toBeNull();
    expect(r.errors.some((e) => e.code === 'unsupported_format')).toBe(true);
  });

  it('blocks zero-size and oversized files', () => {
    expect(inspectVideo(mkVideo({ size_bytes: 0 }), true).errors.some((e) => e.code === 'empty_file')).toBe(true);
    expect(inspectVideo(mkVideo({ size_bytes: 3 * 1024 ** 3 }), true).errors.some((e) => e.code === 'file_too_large')).toBe(true);
  });

  it('blocks when the stored object is missing', () => {
    const r = inspectVideo(mkVideo(), false);
    expect(r.errors.some((e) => e.code === 'file_missing')).toBe(true);
  });

  it('warns (not blocks) on unknown duration/dims', () => {
    const r = inspectVideo(mkVideo({ duration_sec: null, width: null, height: null }), true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['duration_unknown', 'dimensions_unknown']));
  });

  it('skips the existence check when the probe failed', () => {
    const r = inspectVideo(mkVideo(), null);
    expect(r.errors.some((e) => e.code === 'file_missing')).toBe(false);
  });
});

// ── assessAccount — readiness ────────────────────────────────────────────

describe('assessAccount · readiness', () => {
  it('blocks expired accounts with a reconnect fix', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ status: 'expired' }), mkVideo(), baseInput);
    expect(r.ok).toBe(false);
    const e = r.errors.find((i) => i.code === 'account_expired');
    expect(e?.fix).toMatch(/reconnect/i);
  });

  it('blocks revoked accounts', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ status: 'revoked' }), mkVideo(), baseInput);
    expect(r.errors.some((i) => i.code === 'account_revoked')).toBe(true);
  });

  it('blocks a missing stored grant', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ oauth_refresh_token: '' }), mkVideo(), baseInput);
    expect(r.errors.some((i) => i.code === 'grant_missing')).toBe(true);
  });

  it('warns when a Meta token expires soon', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({
      platform: 'facebook',
      token_expires_at: Date.now() + 3 * 24 * 3600_000,
    }), mkVideo(), baseInput);
    expect(r.warnings.some((i) => i.code === 'token_expires_soon')).toBe(true);
  });

  it('blocks an already-expired Meta token', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({
      platform: 'instagram',
      token_expires_at: Date.now() - 1000,
    }), mkVideo(), baseInput);
    expect(r.errors.some((i) => i.code === 'token_expired')).toBe(true);
  });
});

// ── assessAccount — platform rules ───────────────────────────────────────

describe('assessAccount · platform rules', () => {
  it('youtube: requires a title (first caption line)', async () => {
    const r = await assessAccount(mkEnv(), mkAccount(), mkVideo(), { caption: '\nno title line', visibility: 'private' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((i) => /title required/.test(i.message))).toBe(true);
  });

  it('youtube: passes a valid post and previews the real payload', async () => {
    const r = await assessAccount(mkEnv(), mkAccount(), mkVideo(), baseInput);
    expect(r.ok).toBe(true);
    expect(r.preview.title).toBe('Hello world');
    expect(r.preview.tags).toContain('launch');
    expect(r.preview.visibility).toBe('private');
  });

  it('enforces per-platform caption limits', async () => {
    const long = 'x'.repeat(2300);
    const tiktok = await assessAccount(mkEnv(), mkAccount({ platform: 'tiktok' }), mkVideo(), { caption: long, visibility: 'private' });
    expect(tiktok.errors.some((i) => /exceeds/.test(i.message))).toBe(true);
    // Same caption fits YouTube's 5000 limit.
    const yt = await assessAccount(mkEnv(), mkAccount(), mkVideo(), { caption: long, visibility: 'private' });
    expect(yt.errors.some((i) => /exceeds/.test(i.message))).toBe(false);
  });

  it('tiktok: blocks >10min video, warns about SELF_ONLY + aspect', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ platform: 'tiktok' }), mkVideo({ duration_sec: 700 }), baseInput);
    expect(r.errors.some((i) => /exceeds/.test(i.message))).toBe(true);
    expect(r.warnings.some((i) => i.code === 'visibility_forced')).toBe(true);
    expect(r.warnings.some((i) => i.code === 'aspect_mismatch')).toBe(true); // 16:9 not in tiktok list
    expect(r.preview.visibility).toBe('private');
  });

  it('tiktok: preview title merges hashtags like the real init call', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ platform: 'tiktok' }), mkVideo({ width: 1080, height: 1920 }),
      { caption: 'cap text', visibility: 'private', platformParams: JSON.stringify({ tags: ['viral', 'fyp'] }) });
    expect(r.preview.title).toContain('cap text');
    expect(r.preview.title).toContain('#viral');
  });

  it('instagram: blocks >90s Reels', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ platform: 'instagram' }), mkVideo({ duration_sec: 120, width: 1080, height: 1920 }), baseInput);
    expect(r.errors.some((i) => /exceeds/.test(i.message))).toBe(true);
  });

  it('instagram: signs a video_url so validate passes end-to-end', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ platform: 'instagram' }), mkVideo({ width: 1080, height: 1920 }), baseInput);
    // No 'missing video_url' error — the preflight meta mirrors consumer minting.
    expect(r.errors.every((i) => !/video_url/.test(i.message))).toBe(true);
  });

  it('facebook: blocks >90min video', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ platform: 'facebook' }), mkVideo({ duration_sec: 100 * 60, width: 1280, height: 720 }), baseInput);
    expect(r.errors.some((i) => /exceeds/.test(i.message))).toBe(true);
  });

  it('per-platform caption override feeds validation + preview', async () => {
    const r = await assessAccount(mkEnv(), mkAccount({ platform: 'tiktok' }), mkVideo({ width: 1080, height: 1920 }),
      { caption: 'base', visibility: 'private', perPlatformCaption: 'custom tiktok caption' });
    expect(r.preview.caption).toBe('custom tiktok caption');
  });

  it('platform_params title overrides the caption-derived title', async () => {
    const r = await assessAccount(mkEnv(), mkAccount(), mkVideo(),
      { caption: 'first line\nrest', visibility: 'private', platformParams: JSON.stringify({ title: 'Custom YT Title', visibility: 'unlisted' }) });
    expect(r.preview.title).toBe('Custom YT Title');
    expect(r.preview.visibility).toBe('unlisted');
  });
});

// ── POST /api/preflight ──────────────────────────────────────────────────

function fakeDb(video: VideoRow | null, account: AccountRow | null, tv = 0) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('FROM users')) return { token_version: tv };
          if (sql.includes('FROM videos')) return video;
          if (sql.includes('FROM accounts')) return account;
          return null;
        },
      }),
    }),
  } as unknown as D1Database;
}

function routeEnv(video: VideoRow | null, account: AccountRow | null): Env {
  return { ...mkEnv(), DB: fakeDb(video, account) } as Env;
}

async function call(env: Env, token: string | null, body: unknown) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api', preflightRoutes);
  return app.request('http://x/api/preflight', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }, env);
}

describe('POST /api/preflight', () => {
  it('rejects unauthenticated calls', async () => {
    const res = await call(routeEnv(mkVideo(), mkAccount()), null, {});
    expect(res.status).toBe(401);
  });

  it('returns structured per-account results', async () => {
    const token = await signToken('user-1', JWT_SECRET, 0);
    const res = await call(routeEnv(mkVideo(), mkAccount()), token, {
      video_id: 'vid-1', account_ids: ['acc-1'], caption: 'Hello\nworld', visibility: 'private',
    });
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; video: { aspect: string }; accounts: { ok: boolean; platform: string; preview: { title: string } }[] };
    expect(j.ok).toBe(true);
    expect(j.video.aspect).toBe('16:9');
    expect(j.accounts[0]!.platform).toBe('youtube');
    expect(j.accounts[0]!.preview.title).toBe('Hello');
  });

  it('blocks on an expired account and flags it in ok', async () => {
    const token = await signToken('user-1', JWT_SECRET, 0);
    const res = await call(routeEnv(mkVideo(), mkAccount({ status: 'expired' })), token, {
      video_id: 'vid-1', account_ids: ['acc-1'], caption: 't\nb', visibility: 'private',
    });
    const j = await res.json() as { ok: boolean; accounts: { ok: boolean; errors: { code: string }[] }[] };
    expect(j.ok).toBe(false);
    expect(j.accounts[0]!.errors.some((e) => e.code === 'account_expired')).toBe(true);
  });

  it('403s when the video belongs to another user', async () => {
    const token = await signToken('user-1', JWT_SECRET, 0);
    const res = await call(routeEnv(mkVideo({ user_id: 'other' }), mkAccount()), token, {
      video_id: 'vid-1', account_ids: [], caption: 't',
    });
    expect(res.status).toBe(403);
  });

  it('never leaks tokens or storage paths', async () => {
    const token = await signToken('user-1', JWT_SECRET, 0);
    const res = await call(routeEnv(mkVideo(), mkAccount()), token, {
      video_id: 'vid-1', account_ids: ['acc-1'], caption: 't\nb',
    });
    const text = await res.text();
    expect(text).not.toContain('oauth_');
    expect(text).not.toContain('videos/user-1/');
    expect(text).not.toContain('access_token');
  });
});
