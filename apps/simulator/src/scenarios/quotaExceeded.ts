/**
 * quotaExceeded: verifies the schedule endpoint validates scheduled_at lead
 * time. The worker-side quota check requires environment-driven quota tracking
 * (see apps/worker quotas repo); this scenario exercises the API-level guard
 * that prevents scheduling posts in the past or too soon.
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { Buffer } from 'node:buffer';

const TINY_VIDEO = Buffer.from('FAKE_MP4_HEADER_for_simulator_only');

export const quotaExceeded: Scenario = {
  name: 'quotaExceeded',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    let accountId = '';
    let videoId = '';

    await step('connect mock YouTube account', async () => {
      const acc = await ctx.client.connectMockYouTube();
      accountId = acc.id;
    });

    await step('upload video', async () => {
      const v = await ctx.client.uploadVideo(TINY_VIDEO, 'sim3.mp4', 'video/mp4');
      videoId = v.id;
    });

    await step('reject schedule with scheduled_at in the past', async () => {
      let rejected = false;
      try {
        await ctx.client.schedulePost({
          video_id: videoId,
          account_ids: [accountId],
          scheduled_at: Date.now() - 60_000,
          caption: 'past post',
          visibility: 'unlisted',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rejected = /400/.test(msg) && /scheduled_at/.test(msg);
        if (!rejected) throw new Error(`unexpected error: ${msg}`);
      }
      if (!rejected) throw new Error('schedule accepted past timestamp (should reject)');
      return 'API returned 400 for past scheduled_at';
    });

    await step('reject schedule with scheduled_at too soon', async () => {
      let rejected = false;
      try {
        await ctx.client.schedulePost({
          video_id: videoId,
          account_ids: [accountId],
          scheduled_at: Date.now() + 1_000,
          caption: 'too soon',
          visibility: 'unlisted',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rejected = /400/.test(msg) && /(lead|soon|future)/i.test(msg);
        if (!rejected) throw new Error(`unexpected error: ${msg}`);
      }
      if (!rejected) throw new Error('schedule accepted sub-60s lead time');
      return 'API enforces 60s minimum lead';
    });
  },
};
