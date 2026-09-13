import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstagramPublisher } from './instagram.js';
import { FacebookPublisher } from './facebook.js';

interface MockFetch extends Pick<typeof globalThis, 'fetch'> {
  calls(): Array<{ url: string; init?: RequestInit }>;
}

function mockFetch(responses: Array<{ status?: number; body: unknown }>): MockFetch {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
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

describe('InstagramPublisher.validate', () => {
  const p = new InstagramPublisher({ useMock: true, appId: 'app' });
  it('rejects > 2200 char captions', () => {
    const r = p.validate(
      { title: 't', description: '', caption: 'x'.repeat(2201), visibility: 'public' },
      { file_path: '/x', size_bytes: 0, mime: 'video/mp4', duration_sec: 60 },
    );
    expect(r.ok).toBe(false);
  });
  it('rejects videos over 90s', () => {
    const r = p.validate(
      { title: 't', description: '', caption: 'ok', visibility: 'public' },
      { file_path: '/x', size_bytes: 0, mime: 'video/mp4', duration_sec: 91 },
    );
    expect(r.errors.join(' ')).toMatch(/90s/);
  });
});

describe('InstagramPublisher.upload (real flow)', () => {
  it('requires meta.external_id and meta.video_url', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const p = new InstagramPublisher({
        useMock: false,
        appId: 'app',
        fetchImpl: mockFetch([]) as unknown as typeof fetch,
      });
      await expect(
        p.upload({
          access_token: 'at',
          video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
          meta: { title: 't', description: '', caption: 'hi', visibility: 'public' },
        }),
      ).rejects.toThrow(/external_id/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create container → poll status → publish returns id + permalink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const f = mockFetch([
        // 1) create container
        { body: { id: 'container-1' } },
        // 2) status poll — FINISHED
        { body: { status_code: 'FINISHED' } },
        // 3) publish
        { body: { id: 'media-1', permalink: 'https://instagram.com/reel/media-1' } },
      ]);
      const p = new InstagramPublisher({
        useMock: false,
        appId: 'app',
        apiVersion: 'v24.0',
        fetchImpl: f as unknown as typeof fetch,
      });
      const result = await p.upload({
        access_token: 'at',
        video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
        meta: {
          title: 't',
          description: '',
          caption: 'hi',
          visibility: 'public',
          external_id: 'ig-business-1',
          video_url: 'https://example.com/v.mp4',
        },
      });
      expect(result.external_id).toBe('media-1');
      expect(result.url).toBe('https://instagram.com/reel/media-1');
      const calls = f.calls();
      expect(calls[0]?.url).toContain('/v24.0/ig-business-1/media');
      // access_token goes in the JSON body for POST /media. The body
      // may be passed as a string (JSON.stringify) or a Uint8Array
      // depending on the publisher implementation.
      const createBody = JSON.parse(
        typeof calls[0]?.init?.body === 'string'
          ? (calls[0]?.init?.body as string)
          : new TextDecoder().decode(calls[0]?.init?.body as Uint8Array),
      );
      expect(createBody.media_type).toBe('REELS');
      // Status GET carries access_token in the query string.
      expect(calls[1]?.url).toContain('/v24.0/container-1');
      expect(calls[1]?.url).toContain('access_token=at');
      // Publish POST also puts access_token in body.
      expect(calls[2]?.url).toContain('/v24.0/ig-business-1/media_publish');
      const publishBody = JSON.parse(
        typeof calls[2]?.init?.body === 'string'
          ? (calls[2]?.init?.body as string)
          : new TextDecoder().decode(calls[2]?.init?.body as Uint8Array),
      );
      expect(publishBody.creation_id).toBe('container-1');
      expect(publishBody.access_token).toBe('at');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when container status is ERROR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const f = mockFetch([
        { body: { id: 'c' } },
        { body: { status_code: 'ERROR' } },
      ]);
      const p = new InstagramPublisher({
        useMock: false,
        appId: 'app',
        fetchImpl: f as unknown as typeof fetch,
      });
      await expect(
        p.upload({
          access_token: 'at',
          video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
          meta: {
            title: 't', description: '', caption: 'hi', visibility: 'public',
            external_id: 'ig', video_url: 'https://x',
          },
        }),
      ).rejects.toThrow(/ERROR/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('FacebookPublisher.validate', () => {
  const p = new FacebookPublisher({ useMock: true, appId: 'app' });
  it('rejects > 2200 char captions', () => {
    const r = p.validate(
      { title: 't', description: '', caption: 'x'.repeat(2201), visibility: 'public' },
      { file_path: '/x', size_bytes: 0, mime: 'video/mp4', duration_sec: 30 },
    );
    expect(r.ok).toBe(false);
  });
});

describe('FacebookPublisher.upload (real flow)', () => {
  it('POSTs multipart to /<page-id>/videos with file + description', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const f = mockFetch([
        { body: { id: 'fb-video-1', permalink_url: 'https://facebook.com/watch/?v=fb-video-1' } },
      ]);
      const p = new FacebookPublisher({
        useMock: false,
        appId: 'app',
        apiVersion: 'v24.0',
        fetchImpl: f as unknown as typeof fetch,
      });
      const result = await p.upload({
        access_token: 'page-at',
        video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
        meta: {
          title: 'hello world',
          description: '',
          caption: 'fb caption',
          visibility: 'public',
          external_id: 'page-1',
        },
      });
      expect(result.external_id).toBe('fb-video-1');
      const call = f.calls()[0]!;
      expect(call.url).toContain('/v24.0/page-1/videos');
      const body =
        typeof call.init?.body === 'string'
          ? (call.init?.body as string)
          : new TextDecoder().decode(call.init?.body as Uint8Array);
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['content-type']).toMatch(/multipart\/form-data/);
      expect(body).toContain('fb caption');
      expect(body).toContain('hello world');
      rmSync(dir, { recursive: true, force: true });
    } finally {
      // no-op; mirror the other tests' try/finally for symmetry
    }
   });
 
  it('requires meta.external_id (Page id)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-pub-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.alloc(1024, 0));
    try {
      const p = new FacebookPublisher({
        useMock: false,
        appId: 'app',
        fetchImpl: mockFetch([]) as unknown as typeof fetch,
      });
      await expect(
        p.upload({
          access_token: 'at',
          video: { file_path: file, size_bytes: 1024, mime: 'video/mp4', duration_sec: 30 },
          meta: { title: 't', description: '', caption: 'hi', visibility: 'public' },
        }),
      ).rejects.toThrow(/Page id/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
