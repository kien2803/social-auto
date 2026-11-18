import type { Visibility } from '../repos/types';
import type { PublishMeta } from './types';

/**
 * Split a post caption into platform fields:
 *   line 1          → title
 *   lines 2..n      → description
 *   #tags           → tags[]
 *
 * Ported from the legacy worker — including the fix that kept lines 3+
 * (the old split(_, 2) silently dropped them).
 */
export function parseCaption(caption: string, visibility: Visibility): PublishMeta {
  const lines = caption.split(/\r?\n/);
  const title = (lines[0] ?? caption).slice(0, 100);
  const description = lines.slice(1).join('\n').trim();
  const tags = Array.from(caption.matchAll(/#(\w+)/g))
    .map((m) => m[1])
    .filter((t): t is string => Boolean(t));
  return { title, description, caption, tags, visibility };
}
