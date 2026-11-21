import { Hono } from 'hono';
import { VideosRepo } from '../repos/videos';
import { AccountsRepo } from '../repos/accounts';
import { bearerUserId } from '../lib/auth';
import { sniffVideoFormat } from '../lib/fileSniff';
import { inspectVideo } from '../preflight/inspect';
import { assessAccount, type PreflightInput } from '../preflight/assess';
import type { PreflightResponse } from '../preflight/types';
import type { Visibility } from '../repos/types';
import type { Env } from '../env';

const VISIBILITIES: ReadonlySet<string> = new Set(['public', 'unlisted', 'private']);
const MAX_ACCOUNTS = 50;
const CAPTION_MAX = 5000;

interface PreflightBody {
  video_id?: string;
  account_ids?: string[];
  caption?: string;
  per_platform_caption?: Record<string, string>;
  platform_params?: Record<string, unknown>;
  visibility?: Visibility;
}

export const preflightRoutes = new Hono<{ Bindings: Env }>();

/**
 * Pre-publish check: inspects the video, assesses each account (readiness
 * + platform rules + media warnings) and returns the exact payload each
 * publisher would send. No tokens, no storage keys — results only.
 */
preflightRoutes.post('/preflight', async (c) => {
  const userId = await bearerUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as PreflightBody | null;
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const accountIds = Array.isArray(body.account_ids) ? [...new Set(body.account_ids)] : [];
  if (accountIds.length > MAX_ACCOUNTS) {
    return c.json({ error: `too_many_accounts: maximum ${MAX_ACCOUNTS}` }, 400);
  }
  if (body.visibility !== undefined && !VISIBILITIES.has(body.visibility)) {
    return c.json({ error: 'invalid_visibility' }, 400);
  }
  const caption = body.caption ?? '';
  if (caption.length > CAPTION_MAX) return c.json({ error: 'caption_too_long' }, 400);

  // Video — optional (user may check accounts first), always ownership-checked.
  let video = null;
  if (body.video_id) {
    video = await new VideosRepo(c.env.DB).findById(body.video_id);
    if (!video) return c.json({ error: 'video_not_found' }, 404);
    if (video.user_id !== userId) return c.json({ error: 'video_not_owned' }, 403);
  }

  const accounts = new AccountsRepo(c.env.DB);
  const perCaption = body.per_platform_caption ?? {};
  const perParams = body.platform_params ?? {};
  const input: PreflightInput = {
    caption,
    visibility: body.visibility ?? 'private',
  };

  const response: PreflightResponse = { ok: true, video: null, accounts: [], generated_at: Date.now() };

  // Object-existence probe — HEAD is one cheap R2 op; if R2 itself is down
  // we skip the check rather than fabricate a failure.
  let objectExists: boolean | null = null;
  if (video) {
    try {
      objectExists = (await c.env.STORAGE.head(video.file_path)) !== null;
    } catch {
      objectExists = null;
    }
    const inspection = inspectVideo(video, objectExists);

    // Stored mime was sniffed at upload — re-verify cheaply only when the
    // object head is already in hand: an extra 12-byte range read catches a
    // corrupted/replaced object that a renamed file could pass at upload.
    if (objectExists && inspection.format) {
      try {
        const head = await c.env.STORAGE.get(video.file_path, { range: { offset: 0, length: 12 } });
        if (head) {
          const bytes = new Uint8Array(await head.arrayBuffer());
          const sniffed = sniffVideoFormat(bytes);
          if (sniffed && sniffed !== inspection.format) {
            inspection.errors.push({
              code: 'format_mismatch',
              message: `Stored bytes sniff as ${sniffed} but the row is labeled ${inspection.format}.`,
              fix: 'Re-upload the video — the stored object does not match its declared type.',
            });
          }
        }
      } catch { /* best-effort — skip */ }
    }

    response.video = inspection;
    if (inspection.errors.length) response.ok = false;
  }

  for (const accId of accountIds) {
    const acc = await accounts.findById(accId);
    if (!acc) {
      response.accounts.push({
        account_id: accId,
        platform: 'youtube',
        display_name: accId,
        ok: false,
        errors: [{ code: 'account_not_found', message: 'Account not found.' }],
        warnings: [],
        preview: { title: '', description: '', caption: '', tags: [], visibility: input.visibility },
      });
      response.ok = false;
      continue;
    }
    if (acc.user_id !== userId) return c.json({ error: 'account_not_owned' }, 403);

    if (!video) {
      response.accounts.push({
        account_id: acc.id,
        platform: acc.platform,
        display_name: acc.display_name,
        ok: acc.status === 'active',
        errors: acc.status === 'active' ? [] : [{ code: `account_${acc.status}`, message: `${acc.display_name} is ${acc.status} — reconnect in Accounts.` }],
        warnings: [],
        preview: { title: '', description: '', caption: '', tags: [], visibility: input.visibility },
      });
      continue;
    }

    const result = await assessAccount(c.env, acc, video, {
      ...input,
      perPlatformCaption: perCaption[acc.id],
      platformParams: typeof perParams[acc.id] === 'object' && perParams[acc.id] !== null
        ? JSON.stringify(perParams[acc.id])
        : null,
    });
    response.accounts.push(result);
    if (!result.ok) response.ok = false;
  }

  return c.json(response);
});
