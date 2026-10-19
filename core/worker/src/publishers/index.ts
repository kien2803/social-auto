import type { Platform, Publisher } from '@social-auto/shared';
import { YoutubePublisher } from './youtube.js';
import { TiktokPublisher } from './tiktok.js';
import { InstagramPublisher } from './instagram.js';
import { FacebookPublisher } from './facebook.js';
import { env } from '../env.js';
import { createGoogleClient } from './googleClient.js';
import type { QuotasRepo } from '../repositories/quotas.js';

// Quota repository instance (set during initialization)
let quotasRepo: QuotasRepo | null = null;

export function setQuotasRepo(repo: QuotasRepo): void {
  quotasRepo = repo;
}

// Progress tracking callback registry
const progressCallbacks = new Map<string, (progress: number) => void>();

export function registerProgressCallback(videoId: string, callback: (progress: number) => void): void {
  progressCallbacks.set(videoId, callback);
}

export function unregisterProgressCallback(videoId: string): void {
  progressCallbacks.delete(videoId);
}

export function getProgressCallback(videoId: string): ((progress: number) => void) | undefined {
  return progressCallbacks.get(videoId);
}

// Function to trigger progress callbacks
export function triggerProgressCallback(videoId: string, progress: number): void {
  const callback = progressCallbacks.get(videoId);
  if (callback) {
    callback(progress);
  }
}

/**
 * Minimal stub of the YouTube publisher that satisfies the Publisher
 * contract without touching the network or the filesystem. Used in tests
 * (and any other context where USE_MOCK_PUBLISHERS=true) so a missing
 * local video file at /tmp/worker-test.mp4 doesn't make every test fail
 * with ENOENT. Returns a synthetic `mock-yt-…` id so the assertion
 * `external_post_id` matches /^mock-yt-/ in src/index.test.ts.
 */
class StubYoutubePublisher implements Publisher {
  readonly platform = 'youtube' as const;
  validate(): { ok: true; errors: [] } {
    return { ok: true, errors: [] };
  }
  async upload(): Promise<{ external_id: string; url?: string }> {
    return {
      external_id: `mock-yt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

/** Map from platform to its Publisher instance. Built once at startup. */
let cached: Partial<Record<Platform, Publisher>> | null = null;

function build(): Record<Platform, Publisher> {
  const google = createGoogleClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.googleRedirectUri,
  });
  
  const checkQuota = (platform: 'youtube') => {
    if (!quotasRepo) return { used: 0, limit: 10000, remaining: 10000 };
    return quotasRepo.get(platform, Date.now());
  };
  
  const recordQuotaUsage = (platform: 'youtube', units: number) => {
    if (quotasRepo) quotasRepo.incrementUsage(platform, units, Date.now());
  };
  
  return {
    youtube:
      env.useMockPublishers || !env.clientId
        ? new StubYoutubePublisher()
        : new YoutubePublisher({
            clientId: env.clientId,
            clientSecret: env.clientSecret,
            redirectUri: env.googleRedirectUri,
            googleClient: google,
            checkQuota,
            recordQuotaUsage,
            onProgress: (identifier, progress) => {
              // Trigger progress callback for video
              triggerProgressCallback(identifier, progress);
            },
          }),
    tiktok: new TiktokPublisher({
      useMock: env.useMockPublishers || !env.tiktokClientKey,
      clientKey: env.tiktokClientKey,
    }),
    instagram: new InstagramPublisher({
      useMock: env.useMockPublishers || !env.metaAppId,
      appId: env.metaAppId,
    }),
    facebook: new FacebookPublisher({
      useMock: env.useMockPublishers || !env.metaAppId,
      appId: env.metaAppId,
    }),
  };
}

export function getPublisher(platform: Platform): Publisher | null {
  if (!cached) cached = build();
  return cached[platform] ?? null;
}
