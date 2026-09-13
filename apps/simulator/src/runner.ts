#!/usr/bin/env tsx
/**
 * Simulator entry. CLI:
 *   pnpm -F @social-auto/simulator smoke                       # default: happyPath
 *   pnpm -F @social-auto/simulator smoke --all                 # run all scenarios
 *   pnpm -F @social-auto/simulator smoke happyPath retryFlow   # pick by name
 *   pnpm -F @social-auto/simulator smoke --json                # machine-readable
 *
 * Exit code: 0 all pass, 1 any fail, 2 setup error (e.g. API not reachable).
 */
import { ApiClient } from './client.js';
import { SCENARIOS, listScenarioNames, type ScenarioName } from './scenarios/index.js';
import { renderJson, renderText, summarize, type RunReport, type ScenarioReport } from './report.js';
import type { Scenario, ScenarioContext, StepFn } from './scenarios/base.js';

const DEFAULT_BASE = 'http://localhost:3000';
const HEALTH_RETRIES = 15;
const HEALTH_RETRY_MS = 1_000;

interface Args {
  names: string[];
  json: boolean;
  all: boolean;
  baseUrl: string;
}

function parseArgs(argv: string[]): Args {
  const names: string[] = [];
  let json = false;
  let all = false;
  for (const raw of argv) {
    if (raw === '--json') json = true;
    else if (raw === '--all') all = true;
    else if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    } else if (raw.startsWith('--api=')) {
      // Env wins; CLI override applied after this function returns.
    } else if (raw.startsWith('-')) {
      console.error(`[simulator] unknown flag: ${raw}`);
      process.exit(2);
    } else {
      names.push(raw);
    }
  }
  return {
    names,
    json,
    all,
    baseUrl: process.env['API_BASE_URL'] ?? DEFAULT_BASE,
  };
}

function printHelp(): void {
  console.log(
    [
      'Usage: smoke [scenario...] [--all] [--json]',
      '',
      'Scenarios:',
      `  ${listScenarioNames().join(', ')}`,
      '',
      'Flags:',
      '  --all     run every scenario in registry order',
      '  --json    emit a JSON report instead of text',
      '  --help    show this help',
    ].join('\n'),
  );
}

async function waitForApi(baseUrl: string): Promise<void> {
  const client = new ApiClient({ baseUrl });
  for (let i = 0; i < HEALTH_RETRIES; i++) {
    try {
      const res = await client.health();
      if (res.status === 200) return;
    } catch {
      // fall through to retry
    }
    await new Promise((r) => setTimeout(r, HEALTH_RETRY_MS));
  }
  throw new Error(`API not reachable at ${baseUrl}/health after ${HEALTH_RETRIES} tries`);
}

async function runScenario(
  name: string,
  scenario: Scenario,
  ctx: ScenarioContext,
): Promise<ScenarioReport> {
  const started = Date.now();
  const steps: ScenarioReport['steps'] = [];
  let aborted = false;
  let abortError: unknown;
  try {
    await scenario.run(ctx, async (stepName: string, fn: StepFn) => {
      if (aborted) return;
      try {
        const detail = await fn();
        const stepResult: ScenarioReport['steps'][number] = {
          name: stepName,
          pass: true,
        };
        if (typeof detail === 'string') stepResult.detail = detail;
        steps.push(stepResult);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        steps.push({ name: stepName, pass: false, detail: msg });
        aborted = true;
        abortError = err;
      }
    });
  } catch (err) {
    if (!aborted) {
      abortError = err;
    }
  }
  const fail = steps.find((s) => !s.pass);
  const report: ScenarioReport = {
    name,
    pass: !fail && !abortError,
    steps,
    durationMs: Date.now() - started,
  };
  if (abortError !== undefined) {
    report.error = abortError instanceof Error ? abortError.message : String(abortError);
  }
  return report;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const names: string[] = args.all
    ? listScenarioNames()
    : args.names.length > 0
      ? args.names
      : ['happyPath'];

  for (const n of names) {
    if (!SCENARIOS[n]) {
      console.error(`[simulator] unknown scenario: ${n}`);
      console.error(`[simulator] known: ${listScenarioNames().join(', ')}`);
      return 2;
    }
  }

  console.error(`[simulator] waiting for API at ${args.baseUrl}/health`);
  try {
    await waitForApi(args.baseUrl);
  } catch (err) {
    console.error(`[simulator] ${err instanceof Error ? err.message : String(err)}`);
    console.error('[simulator] hint: start API with `pnpm dev` in mock mode');
    return 2;
  }

  const ctx: ScenarioContext = {
    client: new ApiClient({ baseUrl: args.baseUrl }),
    apiBaseUrl: args.baseUrl,
  };

  const report: RunReport = {
    startedAt: Date.now(),
    finishedAt: 0,
    scenarios: [],
  };

  for (const name of names as ScenarioName[]) {
    const scenario = SCENARIOS[name];
    if (!scenario) continue;
    const result = await runScenario(name, scenario, ctx);
    report.scenarios.push(result);
  }

  report.finishedAt = Date.now();

  if (args.json) {
    console.log(renderJson(report));
  } else {
    console.log(renderText(report));
  }

  return summarize(report).allPass ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[simulator] fatal:', err);
    process.exit(2);
  },
);
