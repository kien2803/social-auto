import type { Platform } from '../repos/types';
import type { Publisher } from './types';
import { YoutubePublisher } from './youtube';
import { TiktokPublisher } from './tiktok';
import { FacebookPublisher, InstagramPublisher } from './meta';

const publishers: Partial<Record<Platform, Publisher>> = {};

export function getPublisher(platform: Platform): Publisher | null {
  if (!publishers[platform]) {
    switch (platform) {
      case 'youtube': publishers[platform] = new YoutubePublisher(); break;
      case 'tiktok': publishers[platform] = new TiktokPublisher(); break;
      case 'facebook': publishers[platform] = new FacebookPublisher(); break;
      case 'instagram': publishers[platform] = new InstagramPublisher(); break;
      default: return null;
    }
  }
  return publishers[platform] ?? null;
}
