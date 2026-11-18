import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../env';
import type { PublishInput, PublishMeta, PublishState } from './types';
import { PublishError } from './types';
import { YoutubePublisher } from './youtube';
import { TiktokPublisher } from './tiktok';
import { FacebookPublisher, InstagramPublisher } from './meta';
import { parseCaption } from './caption';
import { categorizePublishError } from '../lib/publishErrors';

// ── harness ──────────────────────────────────────────────────────────────

type FetchImpl = (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }) => Promise<Response>;

interface RecordedReq {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
}

let requests: RecordedReq[] = [];
let fetchImpl: FetchImpl = () => Promise.reject(new Error('no fetch impl'));

const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  });

function fakeStorage(data: Uint8Array) {
  return {
    get: async (_key: string, opts?: { range?: { offset: number; length: number } }) => {
      const { offset = 0, length = data.length } = opts?.range ?? {};
      return { arrayBuffer: async () => data.slice(offset, offset + length).buffer };
    },
  };
}

const VIDEO_BYTES = new Uint8Array(2000).map((_, i) => i % 251);

function mkEnv(): Env {
  return { STORAGE: fakeStorage(VIDEO_BYTES), META_API_VERSION: 'v24.0', WEB_ORIGIN: 'https://app.example' } as unknown as Env;
}

function mkInput(overrides?: Partial<PublishInput>): PublishInput {
  const saved: PublishState[] = [];
  const input: PublishInput = {
    env: mkEnv(),
    access_token: 'tok',
    video: { key: 'videos/u/v1/f.mp4', size_bytes: VIDEO_BYTES.length, mime: 'video/mp4', duration_sec: 30 },
    meta: {
      title: 'My title',
      description: 'My description',
      caption: 'My title\nMy description #tag',
      tags: ['tag'],
      visibility: 'public',
      external_id: 'node-1',
    } as PublishMeta,
    state: null,
    saveState: async (s) => { saved.push(s); },
    ...overrides,
  };
  (input as PublishInput & { saved: PublishState[] }).saved = saved;
  return input;
}

const savedStates = (input: PublishInput) => (input as PublishInput & { saved: PublishState[] }).saved;

beforeEach(() => {
  requests = [];
  fetchImpl = () => Promise.reject(new Error('no fetch impl'));
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      bodyText: typeof init?.body === 'string' ? init.body : undefined,
    });
    return fetchImpl(url, init ?? {});
  });
});

// ── YouTube ───────────────────────────────────────────────────────────────

describe('YoutubePublisher', () => {
  const pub = new YoutubePublisher();
  const UPLOAD = 'https://upload.youtube/session/abc';

  it('validates: requires a title and duration', () => {
    const input = mkInput();
    expect(pub.validate({ ...input.meta, title: '' }, input.video).ok).toBe(false);
    expect(pub.validate(input.meta, { ...input.video, duration_sec: null }).ok).toBe(false);
    expect(pub.validate(input.meta, input.video).ok).toBe(true);
  });

  it('happy path: init → chunks → video id', async () => {
    fetchImpl = async (url, init) => {
      if (url.includes('uploadType=resumable')) return json({}, 200, { location: UPLOAD });
      if (url === UPLOAD && init.method === 'PUT') return json({ id: 'yt-1' });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput();
    const result = await pub.upload(input);
    expect(result.external_id).toBe('yt-1');
    // init saved the session url for resume
    expect(savedStates(input)[0]).toEqual({ upload_url: UPLOAD });
    // init sent snippet/status
    const initReq = requests.find((r) => r.url.includes('uploadType=resumable'))!;
    expect(JSON.parse(initReq.bodyText!).snippet.title).toBe('My title');
    // chunk carried a proper Content-Range
    const chunk = requests.find((r) => r.url === UPLOAD && r.method === 'PUT')!;
    expect(chunk.headers['content-range']).toBe(`bytes 0-${VIDEO_BYTES.length - 1}/${VIDEO_BYTES.length}`);
  });

  it('retry after crash: probes session, resumes from Range offset', async () => {
    fetchImpl = async (url, init) => {
      if (url === UPLOAD && init.method === 'PUT' && init.headers?.['content-length'] === '0') {
        return new Response('', { status: 308, headers: { range: 'bytes=0-999' } });
      }
      if (url === UPLOAD && init.method === 'PUT') return json({ id: 'yt-2' });
      throw new Error(`unexpected ${init.method} ${url}`);
    };
    const input = mkInput({ state: { upload_url: UPLOAD } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('yt-2');
    const resume = requests.find((r) => r.method === 'PUT' && r.headers['content-length'] !== '0')!;
    expect(resume.headers['content-range']).toBe(`bytes 1000-${VIDEO_BYTES.length - 1}/${VIDEO_BYTES.length}`);
  });

  it('lost final response: probe returns the video id — no duplicate upload', async () => {
    fetchImpl = async (url, init) => {
      if (url === UPLOAD && init.method === 'PUT' && init.headers?.['content-length'] === '0') {
        return json({ id: 'yt-done' });
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    };
    const input = mkInput({ state: { upload_url: UPLOAD } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('yt-done');
    // only the probe ran — no data PUTs, no fresh init
    expect(requests).toHaveLength(1);
  });

  it('dead session: probe 404 → fresh init', async () => {
    fetchImpl = async (url, init) => {
      if (url === UPLOAD) return new Response('gone', { status: 404 });
      if (url.includes('uploadType=resumable')) return json({}, 200, { location: `${UPLOAD}/new` });
      if (url === `${UPLOAD}/new`) return json({ id: 'yt-3' });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput({ state: { upload_url: UPLOAD } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('yt-3');
  });

  it('chunk failure throws PublishError carrying the session for resume', async () => {
    fetchImpl = async (url) => {
      if (url.includes('uploadType=resumable')) return json({}, 200, { location: UPLOAD });
      return new Response('boom', { status: 500 });
    };
    const input = mkInput();
    await expect(pub.upload(input)).rejects.toMatchObject({
      name: 'PublishError',
      state: { upload_url: UPLOAD },
    });
  });
});

// ── TikTok ────────────────────────────────────────────────────────────────

describe('TiktokPublisher', () => {
  const pub = new TiktokPublisher();
  const INIT = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
  const STATUS = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
  const TT_UPLOAD = 'https://upload.tiktok/x';

  it('happy path: init → chunks → PUBLISH_COMPLETE', async () => {
    fetchImpl = async (url) => {
      if (url === INIT) return json({ data: { publish_id: 'pid-1', upload_url: TT_UPLOAD }, error: { code: 'ok' } });
      if (url === TT_UPLOAD) return new Response('', { status: 201 });
      if (url === STATUS) return json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['tt-vid-1'] } });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput();
    const result = await pub.upload(input);
    expect(result.external_id).toBe('tt-vid-1');
    expect(savedStates(input)).toEqual([{ publish_id: 'pid-1' }, { publish_id: 'pid-1', uploaded: true }]);
  });

  it('chunk failure clears state — retry re-inits a fresh session', async () => {
    fetchImpl = async (url) => {
      if (url === INIT) return json({ data: { publish_id: 'pid-1', upload_url: TT_UPLOAD }, error: { code: 'ok' } });
      return new Response('bad', { status: 500 });
    };
    const input = mkInput();
    await expect(pub.upload(input)).rejects.toMatchObject({ name: 'PublishError', state: {} });
  });

  it('resume with uploaded flag: skips init+upload, polls only', async () => {
    fetchImpl = async (url) => {
      if (url === STATUS) return json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['tt-9'] } });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput({ state: { publish_id: 'pid-2', uploaded: true } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('tt-9');
    expect(requests.every((r) => r.url === STATUS)).toBe(true);
  });

  it('stale publish_id without uploaded flag: claims orphan if it secretly published', async () => {
    fetchImpl = async (url) => {
      if (url === STATUS) return json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['tt-orphan'] } });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput({ state: { publish_id: 'pid-orphan' } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('tt-orphan');
  });

  it('stale publish_id, dead session: re-inits from scratch', async () => {
    fetchImpl = async (url) => {
      if (url === STATUS) return json({ data: { status: 'FAILED', fail_reason: 'upload expired' } });
      if (url === INIT) return json({ data: { publish_id: 'pid-new', upload_url: TT_UPLOAD }, error: { code: 'ok' } });
      if (url === TT_UPLOAD) return new Response('', { status: 201 });
      throw new Error(`unexpected ${url}`);
    };
    let statusCalls = 0;
    const orig = fetchImpl;
    fetchImpl = async (url, init) => {
      if (url === STATUS) {
        statusCalls++;
        // first call = orphan check → FAILED; later = poll of new session → complete
        return statusCalls === 1
          ? json({ data: { status: 'FAILED', fail_reason: 'upload expired' } })
          : json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['tt-new'] } });
      }
      return orig(url, init);
    };
    const input = mkInput({ state: { publish_id: 'pid-orphan' } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('tt-new');
    expect(requests.some((r) => r.url === INIT)).toBe(true);
  });

  it('publish FAILED clears state for a clean retry', async () => {
    fetchImpl = async (url) => {
      if (url === STATUS) return json({ data: { status: 'FAILED', fail_reason: 'spam_risk_too_many_posts' } });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput({ state: { publish_id: 'pid-2', uploaded: true } });
    await expect(pub.upload(input)).rejects.toMatchObject({ name: 'PublishError', state: {} });
  });

  it('validates: rejects >10min video', () => {
    const input = mkInput();
    expect(pub.validate(input.meta, { ...input.video, duration_sec: 601 }).ok).toBe(false);
  });
});

// ── Facebook ──────────────────────────────────────────────────────────────

describe('FacebookPublisher', () => {
  const pub = new FacebookPublisher();
  const START = 'https://graph.facebook.com/v24.0/node-1/videos';
  const RUPLOAD = 'https://rupload.facebook.com/graph-video/v24.0/sess-1';

  it('happy path: start → chunks → finish', async () => {
    fetchImpl = async (url, init) => {
      if (url === START && init.body && JSON.parse(String(init.body)).upload_phase === 'start') {
        return json({ upload_session_id: 'sess-1', video_id: 'fb-vid-1', start_offset: '0', end_offset: '2000' });
      }
      if (url === RUPLOAD) return json({ start_offset: '2000', end_offset: '2000' });
      if (url === START && init.body && JSON.parse(String(init.body)).upload_phase === 'finish') {
        return json({ success: true });
      }
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput();
    const result = await pub.upload(input);
    expect(result.external_id).toBe('fb-vid-1');
    const finishReq = requests.find((r) => r.url === START && JSON.parse(r.bodyText!).upload_phase === 'finish')!;
    expect(JSON.parse(finishReq.bodyText!).title).toBe('My title');
    expect(savedStates(input).at(-1)).toEqual({ session_id: 'sess-1', video_id: 'fb-vid-1', offset: 2000, finished: true });
  });

  it('finished state + existing video: claims it without any upload calls', async () => {
    fetchImpl = async (url) => {
      if (url.includes('/fb-vid-1?fields=id')) return json({ id: 'fb-vid-1' });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput({ state: { session_id: 'sess-1', video_id: 'fb-vid-1', offset: 2000, finished: true } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('fb-vid-1');
    expect(requests).toHaveLength(1);
  });

  it('finish failure but video exists → recovered, not retried forever', async () => {
    fetchImpl = async (url, init) => {
      if (url === START && init.body && JSON.parse(String(init.body)).upload_phase === 'finish') {
        return json({ error: { message: 'session already closed' } }, 400);
      }
      if (url.includes('/fb-vid-1?fields=id')) return json({ id: 'fb-vid-1' });
      throw new Error(`unexpected ${url}`);
    };
    const input = mkInput({ state: { session_id: 'sess-1', video_id: 'fb-vid-1', offset: 2000 } });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('fb-vid-1');
  });

  it('chunk failure keeps session+offset state for resume', async () => {
    fetchImpl = async (url, init) => {
      if (url === START && init.body && JSON.parse(String(init.body)).upload_phase === 'start') {
        return json({ upload_session_id: 'sess-1', video_id: 'fb-vid-1', start_offset: '0', end_offset: '2000' });
      }
      return new Response('oops', { status: 500 });
    };
    const input = mkInput();
    await expect(pub.upload(input)).rejects.toMatchObject({
      name: 'PublishError',
      state: { session_id: 'sess-1', video_id: 'fb-vid-1', offset: 0 },
    });
  });
});

// ── Instagram ─────────────────────────────────────────────────────────────

describe('InstagramPublisher', () => {
  const pub = new InstagramPublisher();
  const CREATE = 'https://graph.facebook.com/v24.0/node-1/media';
  const PUBLISH = 'https://graph.facebook.com/v24.0/node-1/media_publish';

  const igInput = (state?: PublishState) =>
    mkInput({ state: state ?? null, meta: { ...mkInput().meta, video_url: 'https://app.example/api/media/v1?e=1&s=sig' } });

  it('validates: video_url required', () => {
    const input = mkInput();
    expect(pub.validate({ ...input.meta, video_url: undefined }, input.video).ok).toBe(false);
    expect(pub.validate({ ...input.meta, video_url: 'https://x' }, { ...input.video, duration_sec: 120 }).ok).toBe(false);
  });

  it('happy path: container → FINISHED → media_publish', async () => {
    fetchImpl = async (url, init) => {
      if (url === CREATE) {
        expect(JSON.parse(String(init.body)).video_url).toContain('/api/media/');
        return json({ id: 'cont-1' });
      }
      if (url.includes('/cont-1?fields=status_code')) return json({ status_code: 'FINISHED' });
      if (url === PUBLISH) return json({ id: 'ig-media-1' });
      throw new Error(`unexpected ${url}`);
    };
    const input = igInput();
    const result = await pub.upload(input);
    expect(result.external_id).toBe('ig-media-1');
    expect(savedStates(input).at(-1)).toEqual({ container_id: 'cont-1', media_id: 'ig-media-1' });
  });

  it('container already PUBLISHED → claims it instead of re-publishing', async () => {
    fetchImpl = async (url) => {
      if (url.includes('/cont-1?fields=status_code')) return json({ status_code: 'PUBLISHED' });
      throw new Error(`unexpected ${url}`);
    };
    const input = igInput({ container_id: 'cont-1' });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('cont-1');
    expect(requests.every((r) => r.url.includes('status_code'))).toBe(true);
  });

  it('saved media_id short-circuits — never double-publishes', async () => {
    fetchImpl = async (url) => { throw new Error(`unexpected ${url}`); };
    const input = igInput({ container_id: 'cont-1', media_id: 'ig-9' });
    const result = await pub.upload(input);
    expect(result.external_id).toBe('ig-9');
    expect(requests).toHaveLength(0);
  });

  it('container ERROR clears state for a clean retry', async () => {
    fetchImpl = async (url) => {
      if (url.includes('/cont-1?fields=status_code')) return json({ status_code: 'ERROR', error: { message: 'video download failed' } });
      throw new Error(`unexpected ${url}`);
    };
    const input = igInput({ container_id: 'cont-1' });
    await expect(pub.upload(input)).rejects.toMatchObject({ name: 'PublishError', state: {} });
  });
});

// ── caption + classification ─────────────────────────────────────────────

describe('parseCaption', () => {
  it('splits title/description/tags and keeps lines 3+', () => {
    const m = parseCaption('Title line\nDesc line 1\nDesc line 2 #a #b', 'public');
    expect(m.title).toBe('Title line');
    expect(m.description).toBe('Desc line 1\nDesc line 2 #a #b');
    expect(m.tags).toEqual(['a', 'b']);
  });
});

describe('categorizePublishError', () => {
  const cases: Array<[string, string, boolean]> = [
    ['token_refresh_failed: invalid_grant', 'token_expired', false],
    ['youtube: init failed 401 unauthorized', 'token_expired', false],
    ['youtube: chunk upload failed 403 quotaExceeded', 'rate_limited', true],
    ['429 too many requests', 'rate_limited', true],
    ['instagram: create container: insufficient permissions (#10)', 'missing_permission', false],
    ['tiktok: publish failed: video_duration_check_failed', 'invalid_video', false],
    ['facebook: chunk upload failed 500 oops', 'transient', true],
    ['fetch failed: socket hangup', 'transient', true],
  ];
  for (const [msg, cat, retryable] of cases) {
    it(`"${msg}" → ${cat}`, () => {
      expect(categorizePublishError(new Error(msg))).toEqual({ category: cat, retryable });
    });
  }

  it('PublishError name does not confuse classification', () => {
    expect(categorizePublishError(new PublishError('instagram: container status=ERROR', {}))).toEqual({
      category: 'transient',
      retryable: true,
    });
  });
});
