import type { Platform, ScheduledPostRow } from '@social-auto/shared';
import { classifyHttpError, reportError } from './telemetry.js';

/** Wire shape returned by /videos and /videos/:id. Matches the API's
 *  VideoWire (file_path / thumbnail_path deliberately omitted). */
export interface VideoWire {
  id: string;
  sha256: string;
  size_bytes: number;
  duration_sec: number | null;
  mime: string;
  /** Basename only — full storage path never leaves the server. */
  filename: string;
  has_thumbnail: boolean;
  created_at: number;
}

// Account domain types
//
// These mirror the wire shape returned by the backend's /accounts routes.
// They deliberately exclude any OAuth credential fields (refresh token,
// access token, password, API key, etc.) — those never leave the server.
// `external_id` is the platform-issued opaque channel id and is safe to
// display; we never treat it as a secret.
// ──────────────────────────────────────────────────────────────────────────

export const ACCOUNT_CONTENT_CATEGORIES = ['TECH', 'MEME', 'GADGET', 'ROBLOX'] as const;
export type AccountContentCategory = (typeof ACCOUNT_CONTENT_CATEGORIES)[number];

export const ACCOUNT_LANGUAGE_CODES = ['ENGLISH', 'VIETNAMESE'] as const;
export type AccountLanguageCode = (typeof ACCOUNT_LANGUAGE_CODES)[number] | '';

export interface AccountMetadata {
  /** Free-form content bucket. Empty string when unset. */
  content_category: string;
  language_code: AccountLanguageCode;
  purpose: string;
  link: string;
}

export interface AccountChannelSnapshot {
  /** Platform-issued channel handle, e.g. "@mychannel". '' when unknown. */
  channel_handle: string;
  /** Default avatar URL. '' when unknown. */
  avatar_url: string;
  /** Subscriber count, null if private / unknown. */
  subscribers: number | null;
  /** Total view count, null if private / unknown. */
  views: number | null;
  /** Public video count, null if unknown. */
  video_count: number | null;
  /** Sum of like_count across the channel's recent videos. null if unknown. */
  like_count: number | null;
  /** Average watch time per view, in seconds. null if unknown. */
  avg_watch_seconds: number | null;
  /** Audience drop-off fraction in [0, 1]. null if unknown. */
  drop_off_pct: number | null;
  /** Unix ms of the last successful sync. null = never synced. */
  snapshot_at: number | null;
}

/**
 * One row in the Analytics → "Recent videos" list. The shape mirrors what
 * the YouTube Data API `videos.list?part=snippet,statistics` returns — for
 * now the server seeds these deterministically for mock accounts so the
 * UI can be exercised without live credentials.
 */
export interface ChannelVideo {
  id: string;
  title: string;
  thumbnail_url: string;
  published_at: number;
  duration_sec: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  url: string;
}

export interface ChannelVideoListResponse {
  videos: ChannelVideo[];
}
export interface AccountRow {
  id: string;
  platform: Platform;
  /** Platform-issued opaque channel id — safe to display (truncated). */
  external_id: string;
  display_name: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: number;
  metadata: AccountMetadata;
  channel: AccountChannelSnapshot;
}

export interface AccountListFilter {
  search?: string;
  platform?: Platform | '';
  content?: AccountContentCategory | '';
  language?: Exclude<AccountLanguageCode, ''> | '';
  status?: 'active' | 'expired' | 'revoked' | '';
  limit?: number;
  offset?: number;
}

export interface AccountListResponse {
  accounts: AccountRow[];
  total: number;
}

export interface UpdateAccountInput {
  display_name?: string;
  content_category?: AccountContentCategory | '';
  language_code?: AccountLanguageCode;
  purpose?: string | null;
  link?: string | null;
}
export interface SyncAccountResponse {
  id: string;
  channel: AccountChannelSnapshot;
}


// ────────────────────────────────────────────────────────────────────────────
// Stats / analytics shapes (existing)
// ────────────────────────────────────────────────────────────────────────────

export interface AccountStats {
  account_id: string;
  by_status: Record<string, number>;
  total: number;
  last_published_at: number | null;
}

export interface AnalyticsRow {
  account_id: string;
  platform: string;
  display_name: string;
  by_status: Record<string, number>;
  total: number;
  last_published_at: number | null;
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP layer
// ────────────────────────────────────────────────────────────────────────────

const BASE = '/api';

// Get JWT token from localStorage
function getToken(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return localStorage.getItem('auth_token');
}

// Set JWT token in localStorage
function setToken(token: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  localStorage.setItem('auth_token', token);
}

// Clear JWT token from localStorage
function clearToken(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  localStorage.removeItem('auth_token');
  if (typeof document !== 'undefined') {
    document.cookie = 'oauth_token=; path=/auth; max-age=0';
  }
}

// OAuth connect is a full-page navigation, so the API never sees the
// Authorization header. Copy the JWT into a short-lived cookie scoped to
// /auth so the optional-auth callback can attribute the connected account
// to the logged-in user instead of falling back to 'default-user'.
export function stageOAuthTokenCookie(): void {
  const token = getToken();
  if (!token || typeof document === 'undefined') return;
  document.cookie = `oauth_token=${encodeURIComponent(token)}; path=/auth; max-age=600; SameSite=Lax`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    const token = getToken();
    res = await fetch(url, {
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'authorization': `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    // Network failure — server down, CORS, offline. Surface to telemetry
    // before re-throwing so the page handlers + the React Query subscriber
    // see the same classified error.
    reportError('network', `${method} ${path}`, err, { url });
    throw err;
  }
  if (!res.ok) {
    // Handle 401 Unauthorized - token expired
    if (res.status === 401) {
      clearToken();
      window.location.href = '/login';
      throw new ApiError(401, 'Unauthorized - Please login again');
    }
    const body = await res.json().catch(() => ({}));
    const apiError = new ApiError(res.status, body.error ?? res.statusText);
    reportError(classifyHttpError(res.status), `${method} ${path}`, apiError, {
      url,
      status: res.status,
    });
    throw apiError;
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch (err) {
    reportError('parse', `${method} ${path}`, err, { url, status: res.status });
    throw err;
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
// ────────────────────────────────────────────────────────────────────────────
// API surface
// ────────────────────────────────────────────────────────────────────────────

function accountFilterQs(f?: AccountListFilter): string {
  if (!f) return '';
  const params = new URLSearchParams();
  if (f.search) params.set('search', f.search);
  if (f.platform) params.set('platform', f.platform);
  if (f.content) params.set('content', f.content);
  if (f.language) params.set('language', f.language);
  if (f.status) params.set('status', f.status);
  if (typeof f.limit === 'number') params.set('limit', String(f.limit));
  if (typeof f.offset === 'number') params.set('offset', String(f.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  listVideos: () => req<{ videos: VideoWire[] }>('/videos'),
  getVideo: (id: string) => req<VideoWire>(`/videos/${id}`),
  deleteVideo: (id: string) => req<{ success: boolean; message: string }>(`/videos/${id}`, { method: 'DELETE' }),
  uploadVideo: (file: File, onProgress?: (bytes: number) => void) =>
    uploadFile('/videos', file, onProgress),
  listSchedule: (q?: { status?: string; account_id?: string }) => {
    const params = new URLSearchParams();
    if (q?.status) params.set('status', q.status);
    if (q?.account_id) params.set('account_id', q.account_id);
    const qs = params.toString();
    return req<{ posts: ScheduledPostRow[] }>(`/schedule${qs ? `?${qs}` : ''}`);
  },
  getSchedule: (id: string) => req<ScheduledPostRow>(`/schedule/${id}`),
  createSchedule: (body: CreateScheduleInput) =>
    req<{ posts: ScheduledPostRow[] }>('/schedule', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSchedule: (id: string, patch: UpdateScheduleInput) =>
    req<ScheduledPostRow>(`/schedule/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSchedule: (id: string) => req<{ ok: true }>(`/schedule/${id}`, { method: 'DELETE' }),
  dashboardCounts: () => req<DashboardCounts>('/dashboard/counts'),
  health: () => req<HealthResponse>('/health'),
  quota: () => req<QuotaResponse>('/quota'),
  youtubeQuota: () => req<YouTubeQuotaResponse>('/quota/youtube'),
  getUploadProgress: (videoId: string) => req<UploadProgress>(`/videos/${videoId}/progress`),
  uploadVideoBulk: (files: FileList, onProgress?: (current: number, total: number) => void) =>
    uploadFilesBulk('/videos/bulk', files, onProgress),

  // Account list — server-side filtered, paged, and inclusive of
  // metadata + channel snapshot for the AccountsPage UI.
  listAccounts: (filter?: AccountListFilter) =>
    req<AccountListResponse>(`/accounts${accountFilterQs(filter)}`),
  updateAccount: (id: string, patch: UpdateAccountInput) =>
    req<AccountRow>(`/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteAccount: (id: string) =>
    req<{ ok: true }>(`/accounts/${id}`, { method: 'DELETE' }),
  accountStats: (id: string) => req<AccountStats>(`/accounts/${id}/stats`),
  listChannelVideos: (id: string) =>
    req<ChannelVideoListResponse>(`/accounts/${id}/videos`),
  syncAccount: (id: string) =>
    req<SyncAccountResponse>(`/accounts/${id}/sync`, { method: 'POST', body: '' }),

  analytics: (accountId?: string) => {
    const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    return req<{ rows: AnalyticsRow[] }>(`/analytics${q}`);
  },
  listHistory: (q?: {
    platform?: string;
    status?: string;
    account_id?: string;
    date_from?: string;
  }) => {
    const params = new URLSearchParams();
    if (q?.platform) params.set('platform', q.platform);
    if (q?.status) params.set('status', q.status);
    if (q?.account_id) params.set('account_id', q.account_id);
    if (q?.date_from) params.set('date_from', q.date_from);
    const qs = params.toString();
    return req<{ posts: ScheduledPostRow[] }>(`/history${qs ? `?${qs}` : ''}`);
  },
};

async function uploadFile<T>(
  path: string,
  file: File,
  onProgress?: (bytes: number) => void,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${BASE}${path}`);
  xhr.withCredentials = true;
  xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch (err) {
        reject(err);
      }
    } else {
      let msg = xhr.statusText;
      try {
        msg = JSON.parse(xhr.responseText).error ?? msg;
      } catch {
        // ignore
      }
      reject(new ApiError(xhr.status, msg));
    }
  };
  xhr.onerror = () => reject(new ApiError(0, 'network_error'));
  const fd = new FormData();
  fd.append('file', file);
  xhr.send(fd);
  return promise;
}
async function uploadFilesBulk<T>(
  path: string,
  files: FileList,
  onProgress?: (current: number, total: number) => void,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${BASE}${path}`);
  xhr.withCredentials = true;
  
  let loaded = 0;
  xhr.upload.onprogress = () => {
    loaded++;
    onProgress?.(loaded, files.length);
  };
  
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch (err) {
        reject(err);
      }
    } else {
      let msg = xhr.statusText;
      try {
        msg = JSON.parse(xhr.responseText).error ?? msg;
      } catch {
        // ignore
      }
      reject(new ApiError(xhr.status, msg));
    }
  };
  xhr.onerror = () => reject(new ApiError(0, 'network_error'));
  
  const fd = new FormData();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file) {
      fd.append(`file${i}`, file);
    }
  }
  return promise;
}

export interface CreateScheduleInput {
  video_id: string;
  caption: string;
  per_platform_caption?: Record<string, string>;
  scheduled_at: number;
  visibility?: 'public' | 'unlisted' | 'private';
  account_ids: string[];
}

export interface UpdateScheduleInput {
  caption?: string;
  scheduled_at?: number;
  visibility?: 'public' | 'unlisted' | 'private';
}

export interface DashboardCounts {
  by_status: Record<string, number>;
  published_last_7d: number;
}

// Phase 3 T3.6 — extended /health response.
export interface HealthResponse {
  status: 'ok';
  uptime_sec: number;
  timestamp: number;
  storage_dir: string;
  worker?: {
    status: 'ok';
    last_publish_at: number | null;
    by_status: Record<string, number>;
  };
  accounts?: Array<{
    id: string;
    platform: string;
    display_name: string;
    status: 'active' | 'expired' | 'revoked';
  }>;
}

// Phase 3 T3.2 — /quota response.
export interface QuotaResponse {
  quotas: Array<{
    platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
    used: number;
    limit: number;
    remaining: number;
    reset_at: number;
    warning: boolean;
  }>;
  now: number;
}

export interface YouTubeQuotaResponse {
  platform: 'youtube';
  used: number;
  limit: number;
  remaining: number;
  reset_at: number;
  warning: boolean;
  upload_cost: number;
  uploads_remaining: number;
}

export interface UploadProgress {
  videoId: string;
  progress: number;
  timestamp: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Authentication API
// ────────────────────────────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: number;
}

export const authApi = {
  register: (input: RegisterInput) =>
    req<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  login: (input: LoginInput) =>
    req<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getCurrentUser: () => req<User>('/auth/me'),
};

// Export token utilities for use in AuthContext
export { getToken, setToken, clearToken };
