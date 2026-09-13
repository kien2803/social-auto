/**
 * Scenario contract: each scenario is a stateful function that drives the API
 * via the shared client and records step results. The runner wraps the call so
 * a scenario that throws still produces a report.
 */
import type { ApiClient } from '../client.js';
import type { ScenarioReport, StepResult } from '../report.js';

export interface ScenarioContext {
  client: ApiClient;
  apiBaseUrl: string;
}

export type StepFn = () => Promise<string | undefined | void>;

export interface Scenario {
  name: string;
  /** Run the scenario. Each step should call `step(name, fn)` and bail on first failure. */
  run(ctx: ScenarioContext, step: (name: string, fn: StepFn) => Promise<void>): Promise<void>;
}

export class ScenarioRecorder {
  readonly steps: StepResult[] = [];
  private aborted = false;

  async record(name: string, fn: StepFn): Promise<void> {
    if (this.aborted) return;
    try {
      const detail = await fn();
      this.steps.push({ name, pass: true, ...(detail ? { detail } : {}) });
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}` : String(err);
      this.steps.push({ name, pass: false, detail: msg });
      this.aborted = true;
      throw err;
    }
  }

  finalize(name: string, durationMs: number, error?: unknown): ScenarioReport {
    const fail = this.steps.find((s) => !s.pass);
    return {
      name,
      pass: !fail && !error,
      steps: this.steps,
      durationMs,
      ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
    };
  }
}
