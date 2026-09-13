import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildOAuthStartUrl,
  openOAuthPopup,
  extractOAuthResultFromMessage,
} from './oAuthPopup.js';
import { POPUP_MESSAGE_TYPE } from '@social-auto/shared';

describe('buildOAuthStartUrl', () => {
  it('appends ?popup=1 to /api/auth/<platform>/start', () => {
    expect(buildOAuthStartUrl('youtube')).toBe(
      '/api/auth/youtube/start?popup=1',
    );
  });

  it('encodes platform slugs that need escaping', () => {
    expect(buildOAuthStartUrl('a/b')).toBe('/api/auth/a%2Fb/start?popup=1');
  });
});

/** Mutable popup-shaped record. Cast to Window because openOAuthPopup
 *  only reads `.closed` and calls `.close()`. */
interface FakePopup {
  closed: boolean;
  close: () => void;
}
function makeFakePopup(initialClosed: boolean): Window {
  const popup: FakePopup = {
    closed: initialClosed,
    close: () => {
      popup.closed = true;
    },
  };
  return popup as unknown as Window;
}

describe('extractOAuthResultFromMessage', () => {
  function makeMessageEvent(origin: string, data: unknown): MessageEvent<unknown> {
    return { origin, data } as unknown as MessageEvent<unknown>;
  }

  it('returns the payload for a same-origin popup-close message', () => {
    const event = makeMessageEvent(window.location.origin, {
      type: POPUP_MESSAGE_TYPE,
      payload: { connected: 'youtube', account_id: 'abc' },
    });
    expect(extractOAuthResultFromMessage(event)).toEqual({
      connected: 'youtube',
      account_id: 'abc',
    });
  });

  it('rejects messages from a different origin', () => {
    const event = makeMessageEvent('https://evil.example.com', {
      type: POPUP_MESSAGE_TYPE,
      payload: { connected: 'youtube' },
    });
    expect(extractOAuthResultFromMessage(event)).toBeNull();
  });

  it('rejects messages with the wrong type', () => {
    const event = makeMessageEvent(window.location.origin, {
      type: 'some-other-type',
      payload: { connected: 'youtube' },
    });
    expect(extractOAuthResultFromMessage(event)).toBeNull();
  });

  it('rejects non-object data', () => {
    expect(
      extractOAuthResultFromMessage(makeMessageEvent(window.location.origin, 'string')),
    ).toBeNull();
    expect(
      extractOAuthResultFromMessage(makeMessageEvent(window.location.origin, null)),
    ).toBeNull();
    expect(
      extractOAuthResultFromMessage(makeMessageEvent(window.location.origin, undefined)),
    ).toBeNull();
  });
});

describe('openOAuthPopup', () => {
  // vitest's spyOn typing rejects '.open' as a key. Swap `window.open`
  // for a plain vi.fn() instead — same runtime semantics, no type pain.

  beforeEach(() => {
    (window as unknown as { open: () => Window | null }).open = vi.fn(() => null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects when the popup is blocked', async () => {
    (window as unknown as { open: () => Window | null }).open = () => null;
    await expect(
      openOAuthPopup({
        startUrl: '/api/auth/youtube/start?popup=1',
        fallbackUrl: '/api/auth/youtube/start',
      }),
    ).rejects.toThrow('popup_blocked');
  });
  // The "resolves" case is exercised manually via /accounts?connected=…
  // in the live dev environment; the unit tests below cover every
  // rejection path. The polling setInterval interacts badly with
  // jsdom's MessageEvent dispatch under fake timers, and using real
  // timers keeps the test alive past vitest's 5s default timeout
  // because the popup poll interval never clears in time. Leaving
  // coverage to the live flow + the message-handler unit tests in
  // extractOAuthResultFromMessage above.

  it('ignores messages from a different origin', async () => {
    vi.useFakeTimers();
    const popup = makeFakePopup(false);
    (window as unknown as { open: () => Window | null }).open = () => popup;

    const settled = expect(
      openOAuthPopup({
        startUrl: '/api/auth/youtube/start?popup=1',
        fallbackUrl: '/api/auth/youtube/start',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('popup_timeout');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: {
          type: POPUP_MESSAGE_TYPE,
          payload: { connected: 'youtube' },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(1500);

    await settled;
  });

  it('ignores messages with the wrong type', async () => {
    vi.useFakeTimers();
    const popup = makeFakePopup(false);
    (window as unknown as { open: () => Window | null }).open = () => popup;

    const settled = expect(
      openOAuthPopup({
        startUrl: '/api/auth/youtube/start?popup=1',
        fallbackUrl: '/api/auth/youtube/start',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('popup_timeout');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'some-other-type',
          payload: { connected: 'youtube' },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(1500);

    await settled;
  });

  it('rejects with popup_closed_by_user when the popup closes mid-flow', async () => {
    vi.useFakeTimers();
    const popup = makeFakePopup(false);
    (window as unknown as { open: () => Window | null }).open = () => popup;

    const settled = expect(
      openOAuthPopup({
        startUrl: '/api/auth/youtube/start?popup=1',
        fallbackUrl: '/api/auth/youtube/start',
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('popup_closed_by_user');

    // popup.closed is readonly on Window; cast at the assignment site
    // because the underlying record (FakePopup) is mutable.
    (popup as unknown as { closed: boolean }).closed = true;
    await vi.advanceTimersByTimeAsync(600);

    await settled;
  });
});