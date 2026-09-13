/**
 * multiPlatform: connect one mock account on each of the 4 supported platforms
 * (YouTube + TikTok + Instagram + Facebook), upload a single video, schedule
 * it for +65s across all 4 accounts, then verify each post reaches
 * `published` with a unique external_id per platform.
 *
 * Requires mock mode (USE_MOCK_GOOGLE=true USE_MOCK_PUBLISHERS=true).
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { Buffer } from 'node:buffer';

const TINY_VIDEO = Buffer.from('FAKE_MP4_HEADER_for_simulator_only');
const TERMINAL_TIMEOUT_MS = 130_000;
const POLL_INTERVAL_MS = 2_000;

export const multiPlatform: Scenario = {
  name: 'multiPlatform',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    const accountIds: Record<string, string> = {};
    let videoId = '';
    const postIds: Record<string, string> = {};

    for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook'] as const) {
      await step(`connect mock ${platform} account`, async () => {
        const acc =
          platform === 'youtube'
            ? await ctx.client.connectMockYouTube()
            : await ctx.client.connectMockPlatform(platform);
        accountIds[platform] = acc.id;
        return `${acc.display_name} (${acc.id.slice(0, 8)})`;
      });
    }

    await step('upload one shared video', async () => {
      const v = await ctx.client.uploadVideo(TINY_VIDEO, 'multi.mp4', 'video/mp4');
      videoId = v.id;
    });

    await step('schedule one post per platform at +65s', async () => {
      const ids = Object.values(accountIds);
      const posts = await ctx.client.schedulePost({
        video_id: videoId,
        account_ids: ids,
        scheduled_at: Date.now() + 65_000,
        caption: 'simulator multiPlatform caption',
        visibility: 'unlisted',
      });
      if (posts.length !== ids.length) {
        throw new Error(`expected ${ids.length} posts, got ${posts.length}`);
      }
      // Map each post back to its platform via the account_id.
      for (const post of posts) {
        const platform = Object.entries(accountIds).find(([, id]) => id === post.account_id)?.[0];
        if (!platform) throw new Error(`post ${post.id} has unknown account_id ${post.account_id}`);
        postIds[platform] = post.id;
      }
      return `posts=${posts.length}`;
    });

    await step('all 4 posts reach published with distinct external_ids', async () => {
      const seenExternalIds = new Set<string>();
      const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
      const remaining = new Set(Object.values(postIds));
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
      if (seenExternalIds.size !== 4) {
        throw new Error(`expected 4 distinct external_ids, got ${seenExternalIds.size}`);
      }

      // Each platform's mock returns a prefixed id (mock-yt-…, mock-tt-…,
      // mock-ig-…, mock-fb-…). Walk posts again to confirm the worker
      // dispatched to the right publisher per platform.
      const expectedPrefixes: Record<string, string> = {
        youtube: 'mock-yt-',
        tiktok: 'mock-tt-',
        instagram: 'mock-ig-',
        facebook: 'mock-fb-',
      };
      for (const [platform, postId] of Object.entries(postIds)) {
        const post = await ctx.client.getPost(postId);
        const ext = post.external_post_id ?? '';
        const want = expectedPrefixes[platform];
        if (!want || !ext.startsWith(want)) {
          throw new Error(
            `${platform} post external_id ${ext} does not start with ${want}`,
          );
        }
      }
      return `unique external_ids=${seenExternalIds.size} platforms=4`;
    });
  },
};