/**
 * invalidVideo: verify the upload endpoint rejects unsupported MIME types
 * before any worker involvement. Uses an obviously bad payload (text/plain).
 */
import type { Scenario, ScenarioContext, StepFn } from './base.js';
import { Buffer } from 'node:buffer';

const TEXT_PAYLOAD = Buffer.from('this is not a video, just plain text');

export const invalidVideo: Scenario = {
  name: 'invalidVideo',

  async run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>) {
    await step('reject upload with text/plain mime', async () => {
      try {
        await ctx.client.uploadVideo(TEXT_PAYLOAD, 'fake.txt', 'text/plain');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/415/.test(msg)) return 'API returned 415 Unsupported Media Type';
        throw new Error(`unexpected error: ${msg}`);
      }
      throw new Error('API accepted text/plain as a video');
    });

    await step('reject upload with empty body', async () => {
      try {
        await ctx.client.uploadVideo(Buffer.alloc(0), 'empty.mp4', 'video/mp4');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/400|413|415/.test(msg)) return `API rejected empty body (${msg.split(' ')[0]})`;
        throw new Error(`unexpected error: ${msg}`);
      }
      throw new Error('API accepted empty body as a video');
    });
  },
};
