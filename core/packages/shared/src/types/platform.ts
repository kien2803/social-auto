/**
 * Supported social platforms.
 * Single source of truth — used by DB schema, OAuth routes, publisher factory.
 */
export const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook'] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}