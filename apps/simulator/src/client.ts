/**
 * Thin HTTP client for the social-auto API. Mirrors the routes the simulator
 * needs; no core changes — talks to the live server as an external client.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

export interface ClientOptions {
  baseUrl: string;
  cookieJar?: Map<string, string>;
}

export interface VideoResponse {
  id: string;
  size_bytes: number;
  mime: string;
  sha256: string;
  duration_sec?: number | null;
  thumbnail_path?: string | null;
  deduped?: boolean;
}

export interface AccountResponse {
  id: string;
  platform: string;
  display_name: string;
  status: string;
}

export interface ScheduledPostResponse {
  id: string;
  video_id: string;
  account_id: string;
  scheduled_at: number;
  caption: string;
  visibility: string;
  status: string;
  external_post_id?: string | null;
  last_error?: string | null;
  retry_count: number;
}

interface RequestOptions {
  json?: unknown;
  multipart?: { file: Buffer; filename: string; mime: string };
}

export class ApiClient {
  private baseUrl: string;
  private cookies: Map<string, string>;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.cookies = opts.cookieJar ?? new Map();
  }

  private async req<T>(
    method: string,
    path: string,
    body?: RequestOptions,
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {};
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }

    let payload: Uint8Array | string | undefined;
    if (body?.json !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body?.multipart) {
      const boundary = `----sim${randomUUID()}`;
      headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
      const head = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${body.multipart.filename}"\r\n` +
          `Content-Type: ${body.multipart.mime}\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const combined = Buffer.concat([head, body.multipart.file, tail]);
      payload = new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload as string | Uint8Array | undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.captureCookies(setCookie);

    const contentType = res.headers.get('content-type') ?? '';
    let data: T;
    if (contentType.includes('application/json')) {
      data = (await res.json()) as T;
    } else {
      data = (await res.text()) as unknown as T;
    }
    return { status: res.status, data };
  }

  private captureCookies(setCookieHeader: string): void {
    // Multi-cookie header split on ", " followed by a name=. Naive but enough for this client.
    const parts = setCookieHeader.split(/, (?=[^ ;]+=)/g);
    for (const raw of parts) {
      const part = raw.split(';')[0];
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (value === '' || value === 'deleted') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async health(): Promise<{ status: number; data: { status: string } }> {
    return this.req('GET', '/health');
  }

  /**
   * Walk the mock OAuth flow. Hits /auth/youtube/start to obtain a redirect,
   * follows it to /auth/callback with the synthetic mock code, and returns the
   * resulting account row from /accounts.
   *
   * Mock-mode behaviour in the API: `/auth/youtube/start` redirects straight to
   * `/auth/callback?code=mock-code-…&state=…` (no real Google hop), and the
   * callback exchanges the mock code and creates the YouTube account row.
   */
  async connectMockYouTube(): Promise<AccountResponse> {
    // 1. Hit start. Following the redirect manually is fine for the simulator
    //    (Node's fetch follows by default), but the API endpoint returns a 302
    //    with a Location header so we read it explicitly to keep control.
    const startRes = await fetch(`${this.baseUrl}/auth/youtube/start`, {
      headers: this.cookies.size
        ? { cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
        : {},
      redirect: 'manual',
    });
    const setCookie = startRes.headers.get('set-cookie');
    if (setCookie) this.captureCookies(setCookie);
    const location = startRes.headers.get('location');
    if (!location) {
      throw new Error(`auth start returned no location (status ${startRes.status})`);
    }
    if (startRes.status >= 400) {
      throw new Error(`auth start failed: ${startRes.status}`);
    }

    // 2. Follow the redirect (same-origin). The callback redirects to the web
    //    origin (localhost:5173) on success; that hop must NOT be followed or
    //    the simulator would try to dial the Vite dev server. `redirect: 'manual'`
    //    lets us observe the redirect without chasing it.
    const url = new URL(location, this.baseUrl);
    const cb = await fetch(url.toString(), {
      headers: this.cookies.size
        ? { cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
        : {},
      redirect: 'manual',
    });
    if (cb.status >= 400) {
      const body = await cb.text().catch(() => '');
      throw new Error(`auth callback failed: ${cb.status} ${body}`);
    }
    // 302 to the web origin is the expected terminal state — the account row
    // was written by the server during the callback. Confirm by listing accounts.
    const list = await this.listAccounts();
    const yt = list.find((a) => a.platform === 'youtube');
    if (!yt) throw new Error('mock connect succeeded but no youtube account in /accounts');
    return yt;
  }

  /**
   * Walk the mock OAuth flow for TikTok / Instagram / Facebook. The /start
   * route redirects straight to /accounts?code=... (skips the real OAuth
   * provider). We then hit /auth/<platform>/callback?code=... directly so the
   * server mints the account row and returns a redirect to the web origin
   * we deliberately do not follow.
   */
  async connectMockPlatform(platform: 'tiktok' | 'instagram' | 'facebook'): Promise<AccountResponse> {
    const startRes = await fetch(`${this.baseUrl}/auth/${platform}/start`, {
      headers: this.cookies.size
        ? { cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
        : {},
      redirect: 'manual',
    });
    const setCookie = startRes.headers.get('set-cookie');
    if (setCookie) this.captureCookies(setCookie);
    const location = startRes.headers.get('location');
    if (!location) throw new Error(`auth ${platform} start returned no location (status ${startRes.status})`);
    const u = new URL(location, this.baseUrl);
    const code = u.searchParams.get('code');
    if (!code) throw new Error(`auth ${platform} start missing code in redirect`);

    // For TikTok the mock OAuth flow also returns a `state` query param
    // (mirroring the real PKCE flow). Forward it to the callback so
    // the route's state-mismatch check passes.
    const state = u.searchParams.get('state');
    const cbUrl = state
      ? `${this.baseUrl}/auth/${platform}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
      : `${this.baseUrl}/auth/${platform}/callback?code=${encodeURIComponent(code)}`;
    const cb = await fetch(cbUrl, {
      headers: this.cookies.size
        ? { cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
        : {},
      redirect: 'manual',
    });
    if (cb.status >= 400) {
      const body = await cb.text().catch(() => '');
      throw new Error(`auth ${platform} callback failed: ${cb.status} ${body}`);
    }
    const list = await this.listAccounts();
    const row = list.find((a) => a.platform === platform);
    if (!row) throw new Error(`mock connect succeeded but no ${platform} account in /accounts`);
    return row;
  }

  async listAccounts(): Promise<AccountResponse[]> {
    const res = await this.req<{ accounts: AccountResponse[] } | AccountResponse[]>(
      'GET',
      '/accounts',
    );
    if (Array.isArray(res.data)) return res.data;
    return res.data.accounts ?? [];
  }

  async uploadVideo(file: Buffer, filename: string, mime: string): Promise<VideoResponse> {
    // API returns { video_id, sha256, size_bytes, ... }; rename for callers.
    const res = await this.req<VideoResponse & { error?: string; video_id?: string }>(
      'POST',
      '/videos',
      { multipart: { file, filename, mime } },
    );
    if (res.status >= 400) {
      throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    const d = res.data;
    return { ...d, id: d.id ?? d.video_id ?? '' };
  }

  async schedulePost(body: {
    video_id: string;
    account_ids: string[];
    scheduled_at: number;
    caption: string;
    visibility?: 'public' | 'unlisted' | 'private';
  }): Promise<ScheduledPostResponse[]> {
    const res = await this.req<{ posts: ScheduledPostResponse[] } | { error: string }>(
      'POST',
      '/schedule',
      { json: body },
    );
    if (res.status >= 400) {
      throw new Error(`schedule failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    const data = res.data as { posts: ScheduledPostResponse[] };
    return data.posts;
  }

  async getPost(id: string): Promise<ScheduledPostResponse> {
    const res = await this.req<ScheduledPostResponse | { error: string }>(
      'GET',
      `/schedule/${id}`,
    );
    if (res.status >= 400) {
      throw new Error(`getPost failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    return res.data as ScheduledPostResponse;
  }

  async listPosts(): Promise<ScheduledPostResponse[]> {
    const res = await this.req<{ posts: ScheduledPostResponse[] }>('GET', '/schedule');
    return res.data.posts ?? [];
  }
}
