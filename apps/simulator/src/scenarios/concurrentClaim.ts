/**
 * concurrentClaim: schedule N posts at the same instant, observe that the
 * worker claims them in disjoint batches without publishing the same post twice.
 * The atomic claim is enforced by SQLite's row-level write lock — we verify the
 * observable consequence: every post ends up exactly once, with distinct
 * external_post_ids.
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { Buffer } from 'node:buffer';

const TINY_VIDEO = Buffer.from('FAKE_MP4_HEADER_for_simulator_only');
const N = 5;
const TERMINAL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

export const concurrentClaim: Scenario = {
  name: 'concurrentClaim',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    let accountId = '';
    let videoId = '';
    let postIds: string[] = [];

    await step('connect mock YouTube account', async () => {
      const acc = await ctx.client.connectMockYouTube();
      accountId = acc.id;
    });

    await step('upload one shared video', async () => {
      const v = await ctx.client.uploadVideo(TINY_VIDEO, 'shared.mp4', 'video/mp4');
      videoId = v.id;
    });

    await step(`schedule ${N} posts at the same instant`, async () => {
      const scheduledAt = Date.now() + 65_000;
      const posts = await ctx.client.schedulePost({
        video_id: videoId,
        account_ids: Array.from({ length: N }, () => accountId),
        scheduled_at: scheduledAt,
        caption: 'simulator concurrentClaim caption',
        visibility: 'unlisted',
      });
      postIds = posts.map((p) => p.id);
      if (postIds.length !== N) {
        throw new Error(`expected ${N} posts, got ${postIds.length}`);
      }
      return `ids=${postIds.length}`;
    });

    await step(`all ${N} reach published with distinct external_id`, async () => {
      const seenExternalIds = new Set<string>();
      const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
      const remaining = new Set(postIds);
      while (remaining.size > 0 && Date.now() < deadline) {
        for (const id of [...remaining]) {
          const post = await ctx.client.getPost(id);
          if (post.status === 'published') {
            const ext = post.external_post_id ?? '';
            if (!ext) throw new Error(`post ${id} published without external_id`);
            if (seenExternalIds.has(ext)) {
              throw new Error(`duplicate external_id ${ext} — claim is not atomic`);
            }
            seenExternalIds.add(ext);
            remaining.delete(id);
          } else if (post.status === 'failed' || post.status === 'dead') {
            throw new Error(`post ${id} terminated: ${post.last_error ?? 'n/a'}`);
          }
        }
        if (remaining.size > 0) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      }
      if (remaining.size > 0) {
        throw new Error(`timed out with ${remaining.size} posts still pending`);
      }
      return `unique external_ids=${seenExternalIds.size}`;
    });
  },
};
