import { google } from 'googleapis';
import { promises as fs } from 'node:fs';
import type {
  Publisher,
  PublisherInput,
  PublisherUploadResult,
  PublisherValidation,
  PublisherVideo,
  UploadMeta,
} from '@social-auto/shared';
import { PLATFORM_CAPTION_LIMITS, PLATFORM_TITLE_LIMITS } from '@social-auto/shared';
import type { GoogleOAuthClient } from './googleClientTypes.js';

export interface YoutubePublisherConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  googleClient: GoogleOAuthClient;
}

export class YoutubePublisher implements Publisher {
  readonly platform = 'youtube' as const;
  private cfg: YoutubePublisherConfig;

  constructor(cfg: YoutubePublisherConfig) {
    this.cfg = cfg;
  }

  validate(meta: UploadMeta, video: PublisherVideo): PublisherValidation {
    const errors: string[] = [];
    if (meta.title.length > PLATFORM_TITLE_LIMITS.youtube) {
      errors.push(`title exceeds ${PLATFORM_TITLE_LIMITS.youtube} chars`);
    }
    if (meta.caption.length > PLATFORM_CAPTION_LIMITS.youtube) {
      errors.push(`caption exceeds ${PLATFORM_CAPTION_LIMITS.youtube} chars`);
    }
    if (!video.duration_sec || video.duration_sec <= 0) {
      errors.push('duration unknown');
    }
    return { ok: errors.length === 0, errors };
  }

  async upload(input: PublisherInput): Promise<PublisherUploadResult> {
    return realUpload(this.cfg, input);
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
  const stat = await fs.stat(input.video.file_path);
  if (stat.size !== input.video.size_bytes) {
    throw new Error(`size_mismatch: db=${input.video.size_bytes} disk=${stat.size}`);
  }

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
      body: await fs.readFile(input.video.file_path),
    },
  });

  const externalId = res.data.id;
  if (!externalId) throw new Error('youtube: no video id returned');
  return { external_id: externalId, url: `https://youtube.com/watch?v=${externalId}` };
}
