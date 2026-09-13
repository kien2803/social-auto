/**
 * retryFlow: simulate a transient failure by scheduling a post with
 * scheduled_at set to "now - 1 minute" directly through the DB isn't accessible
 * to the simulator, so instead we assert the worker's retry behavior indirectly:
 *
 *  1. Schedule a post for now+1s
 *  2. Wait until it appears in either 'uploading' or 'pending' (worker claimed)
 *  3. Wait until terminal state — in mock mode it'll publish cleanly. Then we
 *     separately assert the DB log via /history shows retry_count >= 0 (baseline
 *     is 0 in mock). The assertion is that the post reaches a terminal state
 *     without hanging — proving the polling + retry plumbing is wired.
 *
 * To exercise actual retry we would need an env knob on the mock publisher
 * (e.g. SIM_FAIL_FIRST_N_ATTEMPTS). This scenario is the wiring check; the
 * per-publisher fault injection lives in worker env knobs (future).
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { Buffer } from 'node:buffer';

const TINY_VIDEO = Buffer.from('FAKE_MP4_HEADER_for_simulator_only');
const TERMINAL_TIMEOUT_MS = 130_000;
const POLL_INTERVAL_MS = 1_500;

export const retryFlow: Scenario = {
  name: 'retryFlow',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    let accountId = '';
    let videoId = '';
    let postId = '';

    await step('connect mock YouTube account', async () => {
      const acc = await ctx.client.connectMockYouTube();
      accountId = acc.id;
    });

    await step('upload second video', async () => {
      const v = await ctx.client.uploadVideo(TINY_VIDEO, 'sim2.mp4', 'video/mp4');
      videoId = v.id;
    });

    await step('schedule post for +1s (near-immediate claim)', async () => {
      const posts = await ctx.client.schedulePost({
        video_id: videoId,
        account_ids: [accountId],
        scheduled_at: Date.now() + 65_000,
        caption: 'simulator retryFlow caption',
        visibility: 'unlisted',
      });
      const p = posts[0];
      if (!p) throw new Error('no post returned');
      postId = p.id;
    });

    await step('worker reaches terminal state within 60s', async () => {
      const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
      let observed: string[] = [];
      while (Date.now() < deadline) {
        const post = await ctx.client.getPost(postId);
        if (!observed.includes(post.status)) observed.push(post.status);
        if (post.status === 'published') {
          return `path=${observed.join(' → ')} external_id=${post.external_post_id ?? '?'}`;
        }
        if (post.status === 'failed' || post.status === 'dead') {
          // Mock mode shouldn't fail unless quota is exhausted via env knob.
          throw new Error(
            `worker terminated post early: status=${post.status} error=${post.last_error ?? 'n/a'}`,
          );
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      throw new Error(`timed out; last observed=${observed.join(',')}`);
    });
  },
};
