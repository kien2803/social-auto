/**
 * multiAccount: connect two distinct mock YouTube accounts, schedule the
 * same video to both at the same instant, and verify each reaches
 * `published` with a unique external_id.
 *
 * Requires mock mode (USE_MOCK_GOOGLE=true USE_MOCK_PUBLISHERS=true) so
 * `connectMockYouTube` round-robins over the mock channel pool.
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { Buffer } from 'node:buffer';

const TINY_VIDEO = Buffer.from('FAKE_MP4_HEADER_for_simulator_only');
const TERMINAL_TIMEOUT_MS = 130_000;
const POLL_INTERVAL_MS = 2_000;

export const multiAccount: Scenario = {
  name: 'multiAccount',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    let accountAId = '';
    let accountBId = '';
    let videoId = '';
    let postAId = '';
    let postBId = '';

    await step('connect first mock YouTube account', async () => {
      const acc = await ctx.client.connectMockYouTube();
      accountAId = acc.id;
      return `${acc.display_name} (${acc.id.slice(0, 8)})`;
    });

    await step('connect second mock YouTube account', async () => {
      const acc = await ctx.client.connectMockYouTube();
      accountBId = acc.id;
      return `${acc.display_name} (${acc.id.slice(0, 8)})`;
    });

    await step('assert /accounts returns both rows', async () => {
      const list = await ctx.client.listAccounts();
      const yt = list.filter((a) => a.platform === 'youtube');
      if (yt.length < 2) throw new Error(`expected ≥2 accounts, got ${yt.length}`);
      const ids = new Set(yt.map((a) => a.id));
      if (!ids.has(accountAId) || !ids.has(accountBId)) {
        throw new Error('connected accounts missing from /accounts list');
      }
      return `count=${yt.length}`;
    });

    await step('upload one shared video', async () => {
      const v = await ctx.client.uploadVideo(TINY_VIDEO, 'multi.mp4', 'video/mp4');
      videoId = v.id;
    });

    await step('schedule one post to both accounts at +65s', async () => {
      const posts = await ctx.client.schedulePost({
        video_id: videoId,
        account_ids: [accountAId, accountBId],
        scheduled_at: Date.now() + 65_000,
        caption: 'simulator multiAccount caption',
        visibility: 'unlisted',
      });
      if (posts.length !== 2) throw new Error(`expected 2 posts, got ${posts.length}`);
      postAId = posts[0]!.id;
      postBId = posts[1]!.id;
      return `posts=${posts.length}`;
    });

    await step('both posts reach published with distinct external_id', async () => {
      const seenExternalIds = new Set<string>();
      const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
      const remaining = new Set([postAId, postBId]);
      while (remaining.size > 0 && Date.now() < deadline) {
        for (const id of [...remaining]) {
          const post = await ctx.client.getPost(id);
          if (post.status === 'published') {
            const ext = post.external_post_id ?? '';
            if (!ext) throw new Error(`post ${id} published without external_id`);
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
      if (seenExternalIds.size !== 2) {
        throw new Error(`expected 2 distinct external_ids, got ${seenExternalIds.size}`);
      }
      return `unique external_ids=${seenExternalIds.size}`;
    });
  },
};
