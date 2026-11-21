import type { Platform, Visibility } from '../repos/types';
import { parseCaption } from './caption';
import type { PublishMeta } from './types';

/**
 * Build the exact PublishMeta a post's publisher will receive — caption
 * split, per-platform params merged, graph node + pull URL attached.
 *
 * Shared between the queue consumer (processPublish) and the preflight
 * endpoint so what preflight validates is byte-for-byte what ships.
 */
export async function buildPublishMeta(args: {
  caption: string;
  visibility: Visibility;
  platformParams?: string | null;
  platform: Platform;
  externalId: string;
  /** Called only for instagram — returns the signed public pull URL. */
  signVideoUrl?: (videoId: string) => Promise<string>;
  videoId?: string;
}): Promise<PublishMeta> {
  const meta = parseCaption(args.caption, args.visibility);
  if (args.platformParams) {
    try {
      const p = JSON.parse(args.platformParams) as { title?: string; tags?: string[]; visibility?: Visibility };
      if (typeof p.title === 'string' && p.title.trim()) meta.title = p.title.trim();
      if (Array.isArray(p.tags) && p.tags.length) meta.tags = p.tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
      if (p.visibility === 'public' || p.visibility === 'unlisted' || p.visibility === 'private') meta.visibility = p.visibility;
    } catch { /* malformed JSON — fall back to caption-derived meta */ }
  }
  meta.external_id = args.externalId;
  if (args.platform === 'instagram' && args.signVideoUrl && args.videoId) {
    // IG pulls a public URL — mint the same short-lived signed grant the
    // consumer mints, so validation checks the real field.
    meta.video_url = await args.signVideoUrl(args.videoId);
  }
  return meta;
}
