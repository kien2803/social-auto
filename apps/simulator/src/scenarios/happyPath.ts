/**
 * happyPath: connect mock YouTube → upload tiny video → schedule 5s ahead
 * → wait for worker to claim and publish → assert post.status === 'published'.
 *
 * Requires: API + worker running with USE_MOCK_GOOGLE=true USE_MOCK_PUBLISHERS=true
 * and a fresh DB (no prior /auth/youtube/start invocations without cleanup).
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { ScenarioRecorder } from './base.js';
import { Buffer } from 'node:buffer';

const TINY_VIDEO = Buffer.from('FAKE_MP4_HEADER_for_simulator_only');
const POST_VISIBILITY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

export const happyPath: Scenario = {
  name: 'happyPath',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    const rec = new ScenarioRecorder();

    let accountId = '';
    let videoId = '';
    let postId = '';

    await step('connect mock YouTube account', async () => {
      const acc = await ctx.client.connectMockYouTube();
      accountId = acc.id;
      return `${acc.display_name} (${acc.id.slice(0, 8)})`;
    });

    await step('upload video (10s, 1024 bytes)', async () => {
      const v = await ctx.client.uploadVideo(TINY_VIDEO, 'sim.mp4', 'video/mp4');
      videoId = v.id;
      return `${v.id.slice(0, 8)} size=${v.size_bytes}`;
    });

    const scheduledAt = Date.now() + 65_000;
    await step('schedule post for +65s', async () => {
      const posts = await ctx.client.schedulePost({
        video_id: videoId,
        account_ids: [accountId],
        scheduled_at: scheduledAt,
        caption: 'simulator happyPath caption',
        visibility: 'unlisted',
      });
      const p = posts[0];
      if (!p) throw new Error('no post returned');
      postId = p.id;
      return `post=${postId.slice(0, 8)} at=${new Date(scheduledAt).toISOString()}`;
    });

    await step('worker publishes within 90s', async () => {
      const deadline = Date.now() + POST_VISIBILITY_TIMEOUT_MS;
      let lastStatus = 'pending';
      while (Date.now() < deadline) {
        const post = await ctx.client.getPost(postId);
        lastStatus = post.status;
        if (post.status === 'published') {
          return `status=published external_id=${post.external_post_id ?? '?'}`;
        }
        if (post.status === 'failed' || post.status === 'dead') {
          throw new Error(`worker marked post ${post.status}: ${post.last_error ?? 'no error'}`);
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      throw new Error(`timed out waiting for publish; last status=${lastStatus}`);
    });
  },
};

export const _recorderForTests = ScenarioRecorder;
// re-export so runner can attach the recorder result; consumers import happyPath directly.
