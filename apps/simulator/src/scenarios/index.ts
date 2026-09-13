import { happyPath } from './happyPath.js';
import { retryFlow } from './retryFlow.js';
import { quotaExceeded } from './quotaExceeded.js';
import { concurrentClaim } from './concurrentClaim.js';
import { invalidVideo } from './invalidVideo.js';
import { multiAccount } from './multiAccount.js';
import { multiPlatform } from './multiPlatform.js';
import type { Scenario } from './base.js';
export const SCENARIOS: Record<string, Scenario> = {
  happyPath,
  retryFlow,
  quotaExceeded,
  concurrentClaim,
  invalidVideo,
  multiAccount,
  multiPlatform,
};

export const SCENARIO_ORDER = [
  'happyPath',
  'retryFlow',
  'quotaExceeded',
  'concurrentClaim',
  'invalidVideo',
  'multiAccount',
  'multiPlatform',
] as const;

export type ScenarioName = (typeof SCENARIO_ORDER)[number];

export function listScenarioNames(): string[] {
  return [...SCENARIO_ORDER];
}
