import { google } from 'googleapis';
import { createReadStream, statSync } from 'node:fs';
import type {
  Publisher,
  PublisherInput,
  PublisherUploadResult,
  PublisherValidation,
  PublisherVideo,
  UploadMeta,
} from '@social-auto/shared';
import { 
  PLATFORM_CAPTION_LIMITS, 
  PLATFORM_TITLE_LIMITS,
  validateVideoForPlatform 
} from '@social-auto/shared';
import type { GoogleOAuthClient } from './googleClientTypes.js';
import { UNITS_PER_UPLOAD } from '../repositories/quotas.js';

export interface YoutubePublisherConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  googleClient: GoogleOAuthClient;
  checkQuota?: (platform: 'youtube') => { used: number; limit: number; remaining: number };
  recordQuotaUsage?: (platform: 'youtube', units: number) => void;
  onProgress?: (identifier: string, progress: number) => void;
}

export class YoutubePublisher implements Publisher {
  readonly platform = 'youtube' as const;
  private cfg: YoutubePublisherConfig;

  constructor(cfg: YoutubePublisherConfig) {
    this.cfg = cfg;
  }

  validate(meta: UploadMeta, video: PublisherVideo): PublisherValidation {
    const errors: string[] = [];
    
    // Title and caption validation
    if (meta.title.length > PLATFORM_TITLE_LIMITS.youtube) {
      errors.push(`title exceeds ${PLATFORM_TITLE_LIMITS.youtube} chars`);
    }
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.youtube) {
      errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.youtube} chars`);
    }
    if (!video.duration_sec || video.duration_sec <= 0) {
      errors.push('duration unknown');
    }
    
    // Platform-specific video validation
    const videoValidation = validateVideoForPlatform('youtube', video);
    if (!videoValidation.valid) {
      errors.push(...videoValidation.issues);
    }
    
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublisherInput): Promise<PublisherUploadResult> {
    // Check quota before upload if quota checking is enabled
    if (this.cfg.checkQuota) {
      const quota = this.cfg.checkQuota('youtube');
      if (quota.remaining < UNITS_PER_UPLOAD.youtube) {
        throw new Error(`YouTube quota insufficient: ${quota.remaining} units remaining, ${UNITS_PER_UPLOAD.youtube} units required`);
      }
    }

    const result = await realUpload(this.cfg, input);

    // Record quota usage after successful upload
    if (this.cfg.recordQuotaUsage) {
      this.cfg.recordQuotaUsage('youtube', UNITS_PER_UPLOAD.youtube);
    }

    return result;
  }
}


async function realUpload(
  cfg: YoutubePublisherConfig,
  input: PublisherInput,
): Promise<PublisherUploadResult> {
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  oauth2.setCredentials({ access_token: input.access_token });
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });

  // Verify file exists & size matches.
  const stat = statSync(input.video.file_path);
  if (stat.size !== input.video.size_bytes) {
    throw new Error(`size_mismatch: db=${input.video.size_bytes} disk=${stat.size}`);
  }

  // Use resumable upload for files > 10MB, direct upload for smaller files
  const fileSize = stat.size;
  const useResumable = fileSize > 10 * 1024 * 1024; // 10MB threshold

  // Use video file path as progress identifier (since PublisherVideo doesn't have id)
  const progressIdentifier = input.video.file_path;

  if (useResumable) {
    return await resumableUpload(youtube, input, fileSize, progressIdentifier, cfg.onProgress);
  } else {
    return await directUpload(youtube, input, fileSize, progressIdentifier, cfg.onProgress);
  }
}

async function directUpload(
  youtube: any,
  input: PublisherInput,
  fileSize: number,
  progressIdentifier: string,
  onProgress?: (identifier: string, progress: number) => void,
): Promise<PublisherUploadResult> {
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: input.meta.title,
        description: input.meta.description,
        tags: input.meta.tags,
      },
      status: {
        privacyStatus: input.meta.visibility,
      },
    },
    media: {
      body: createReadStream(input.video.file_path),
    },
  });

  if (onProgress) {
    onProgress(progressIdentifier, 100); // Direct upload completes immediately
  }

  const externalId = res.data.id;
  if (!externalId) throw new Error('youtube: no video id returned');
  return { external_id: externalId, url: `https://youtube.com/watch?v=${externalId}` };
}

async function resumableUpload(
  youtube: any,
  input: PublisherInput,
  fileSize: number,
  progressIdentifier: string,
  onProgress?: (identifier: string, progress: number) => void,
): Promise<PublisherUploadResult> {
  // Initialize resumable upload session with proper chunking
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks as per YouTube recommendation
  
  // Progress tracking with estimation
  let bytesUploaded = 0;
  let progressInterval: NodeJS.Timeout | null = null;
  
  if (onProgress) {
    progressInterval = setInterval(() => {
      // Estimate progress - this is approximate since we don't get real-time feedback from YouTube API
      bytesUploaded += CHUNK_SIZE;
      const progress = Math.min(100, (bytesUploaded / fileSize) * 100);
      onProgress(progressIdentifier, progress);
      if (progress >= 100 && progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    }, 1000); // Update every second as approximation
  }
  
  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: input.meta.title,
          description: input.meta.description,
          tags: input.meta.tags,
        },
        status: {
          privacyStatus: input.meta.visibility,
        },
      },
      media: {
        body: createReadStream(input.video.file_path),
        mimeType: 'video/*',
      },
    }, {
      // Force resumable upload
      supportsMediaUpload: true,
      supportsAllDrives: true,
      mediaUploadOptions: {
        chunkSize: CHUNK_SIZE,
        supportsMediaUpload: true,
      },
    });

    // Clear progress interval and mark as complete
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    if (onProgress) {
      onProgress(progressIdentifier, 100);
    }

    const externalId = res.data.id;
    if (!externalId) throw new Error('youtube: no video id returned');
    return { external_id: externalId, url: `https://youtube.com/watch?v=${externalId}` };
  } catch (error) {
    // Clear progress interval on error
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    throw error;
  }
}
