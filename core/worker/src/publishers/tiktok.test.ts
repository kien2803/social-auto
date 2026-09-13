import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TiktokPublisher } from './tiktok.js';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface MockFetch extends Pick<typeof globalThis, 'fetch'> {
  calls(): FetchCall[];
}

function mockFetch(responses: Array<{ status?: number; body: unknown }>): MockFetch {
  const calls: FetchCall[] = [];
  let i = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const next = responses[i] ?? responses[responses.length - 1];
    if (!next) throw new Error(`mockFetch: no response queued for call #${i + 1} ${url}`);
    i += 1;
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(body, {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Object.assign(impl, { calls: () => calls }) as unknown as MockFetch;
}

describe('TiktokPublisher.validate', () => {
  const p = new TiktokPublisher({ useMock: true, clientKey: 'ck' });
  it('rejects captions over 2200 chars', () => {
    const r = p.validate(
      { title: 't', description: '', caption: 'x'.repeat(2201), visibility: 'public' },
      { file_path: '/x', size_bytes: 0, mime: 'video/mp4', duration_sec: 30 },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/caption/);
  });

  it('accepts a 30s video', () => {
    const r = p.validate(
      { title: 't', description: '', caption: 'short', visibility: 'public' },
      { file_path: '/x', size_bytes: 0, mime: 'video/mp4', duration_sec: 30 },
    );
    expect(r.ok).toBe(true);
  });
});

describe('TiktokPublisher.upload (real flow)', () => {
  it('does init → PUT → status poll and returns publish_id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiktok-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const f = mockFetch([
        // init
        {
          body: {
            data: { publish_id: 'pid-1', upload_url: 'https://upload.example/x' },
            error: { code: 'ok' },
          },
        },
        // PUT (the mock fetch returns the same JSON for any URL, but
        // upload_url is a distinct host — we need a separate stub for
        // it. Reuse the same fetch — the response shape doesn't matter
        // for the PUT).
        { body: { ok: true } },
        // status (poll 1 — still processing)
        { body: { data: { status: 'PROCESSING_DOWNLOAD' } } },
        // status (poll 2 — done)
        { body: { data: { status: 'PUBLISH_COMPLETE' } } },
      ]);
      const p = new TiktokPublisher({
        useMock: false,
        clientKey: 'ck',
        fetchImpl: f as unknown as typeof fetch,
      });
      const result = await p.upload({
        access_token: 'at',
        video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
        meta: { title: 't', description: '', caption: 'hello', visibility: 'public' },
      });
      expect(result.external_id).toBe('pid-1');
      const calls = f.calls();
      // 1) init 2) PUT 3-4) two status polls
      expect(calls[0]?.url).toBe('https://open.tiktokapis.com/v2/post/publish/video/init/');
      expect(calls[1]?.url).toBe('https://upload.example/x');
      expect(calls[2]?.url).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
      expect(calls[2]?.init?.method).toBe('POST');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when init returns an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiktok-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const f = mockFetch([
        { body: { error: { code: 'spam_risk_user_banned_from_posting', message: 'banned' } } },
      ]);
      const p = new TiktokPublisher({
        useMock: false,
        clientKey: 'ck',
        fetchImpl: f as unknown as typeof fetch,
      });
      await expect(
        p.upload({
          access_token: 'at',
          video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
          meta: { title: 't', description: '', caption: 'hi', visibility: 'public' },
        }),
      ).rejects.toThrow(/banned/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on size mismatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiktok-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const p = new TiktokPublisher({
        useMock: false,
        clientKey: 'ck',
        fetchImpl: mockFetch([]) as unknown as typeof fetch,
      });
      await expect(
        p.upload({
          access_token: 'at',
          video: { file_path: file, size_bytes: 9999, mime: 'video/mp4', duration_sec: 30 },
          meta: { title: 't', description: '', caption: 'hi', visibility: 'public' },
        }),
      ).rejects.toThrow(/size_mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TiktokPublisher.upload (mock)', () => {
  it('returns a mock-tt- external id when useMock', async () => {
    const p = new TiktokPublisher({ useMock: true, clientKey: '' });
    const result = await p.upload({
      access_token: 'mock-tt-anything',
      video: { file_path: '/dev/null', size_bytes: 0, mime: 'video/mp4', duration_sec: 30 },
      meta: { title: 't', description: '', caption: 'hi', visibility: 'public' },
    });
    expect(result.external_id).toMatch(/^mock-tt-/);
  });

  it('rejects non-mock access tokens in mock mode', async () => {
    const p = new TiktokPublisher({ useMock: true, clientKey: '' });
    await expect(
      p.upload({
        access_token: 'real-token',
        video: { file_path: '/dev/null', size_bytes: 0, mime: 'video/mp4', duration_sec: 30 },
        meta: { title: 't', description: '', caption: 'hi', visibility: 'public' },
      }),
    ).rejects.toThrow(/invalid access token/);
  });
});
