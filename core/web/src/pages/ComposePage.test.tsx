/**
 * ComposePage pre-flight tests — the validation panel calls /api/preflight
 * when a video + account are selected, blocks scheduling on errors, and
 * lets warnings through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast.js';
import { ComposePage } from './ComposePage.js';
import type React from 'react';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const VIDEO = {
  id: 'vid-1', sha256: 'a', size_bytes: 40 * 1024 ** 2, duration_sec: 30,
  width: 1080, height: 1920, mime: 'video/mp4', filename: 'clip.mp4',
  has_thumbnail: false, created_at: 1_700_000_000_000,
};
const ACCOUNT = {
  id: 'acc-1', platform: 'youtube', external_id: 'UC_x', display_name: 'Test Channel',
  status: 'active', created_at: 1_700_000_000_000,
  metadata: {}, channel: { channel_handle: '', avatar_url: '', subscribers: null, views: null, video_count: null, snapshot_at: null },
};

function mockApi(preflight: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (d: unknown, status = 200) =>
      new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/api/videos')) return json({ videos: [VIDEO] });
    if (url.includes('/api/accounts')) return json({ accounts: [ACCOUNT] });
    if (url.includes('/api/preflight')) return json(preflight);
    return json({}, 404);
  });
}

interface Harness { root: Root; container: HTMLElement }
function mount(): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter><ComposePage /></MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  return { root, container };
}
const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const PF_OK = {
  ok: true,
  video: { mime: 'video/mp4', format: 'mp4', size_bytes: VIDEO.size_bytes, duration_sec: 30, width: 1080, height: 1920, aspect: '9:16', errors: [], warnings: [] },
  accounts: [{ account_id: 'acc-1', platform: 'youtube', display_name: 'Test Channel', ok: true, errors: [], warnings: [], preview: { title: 'hi', description: '', caption: 'hi', tags: [], visibility: 'private' } }],
  generated_at: Date.now(),
};
const PF_BLOCKED = {
  ...PF_OK,
  ok: false,
  accounts: [{ ...PF_OK.accounts[0]!, ok: false, errors: [{ code: 'account_expired', message: 'Token expired.', fix: 'Reconnect in Accounts.' }], warnings: [] }],
};

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

async function compose() {
  vi.stubGlobal('fetch', mockApi(PF_OK));
  const h = mount();
  for (let i = 0; i < 60; i++) await flush(10);
  // select the video
  const vidBtn = [...h.container.querySelectorAll('button')].find((b) => b.textContent?.includes('clip.mp4'));
  expect(vidBtn).toBeTruthy();
  act(() => { vidBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  // select the account
  const accBtn = [...h.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Test Channel'));
  act(() => { accBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  // caption (required)
  const ta = h.container.querySelector('textarea')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, 'hello caption');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (let i = 0; i < 60; i++) await flush(10);
  return h;
}

describe('ComposePage — pre-flight checks', () => {
  it('calls /api/preflight once video + account + caption are set', async () => {
    await compose();
    const fetches = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(fetches.some((u) => u.includes('/api/preflight'))).toBe(true);
  });

  it('shows "ready" and enables Schedule when preflight passes', async () => {
    const h = await compose();
    expect(h.container.textContent).toContain('ready');
    const btn = [...h.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Schedule post'));
    expect(btn?.hasAttribute('disabled')).toBe(false);
  });

  it('disables Schedule on blocking errors and shows the fix', async () => {
    vi.stubGlobal('fetch', mockApi(PF_BLOCKED));
    const h = mount();
    for (let i = 0; i < 60; i++) await flush(10);
    const vidBtn = [...h.container.querySelectorAll('button')].find((b) => b.textContent?.includes('clip.mp4'))!;
    act(() => { vidBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const accBtn = [...h.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Test Channel'))!;
    act(() => { accBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const ta = h.container.querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'hello');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 60; i++) await flush(10);
    expect(h.container.textContent).toContain('Token expired.');
    const btn = [...h.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Schedule post'));
    expect(btn?.hasAttribute('disabled')).toBe(true);
  });
});
