/**
 * Step-level pass/fail reporter. Each scenario emits an ordered list of steps;
 * a failing step aborts the scenario but other scenarios still run.
 */
export interface StepResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface ScenarioReport {
  name: string;
  pass: boolean;
  steps: StepResult[];
  durationMs: number;
  error?: string;
}

export interface RunReport {
  startedAt: number;
  finishedAt: number;
  scenarios: ScenarioReport[];
}

function fmt(detail?: string): string {
  return detail ? ` — ${detail}` : '';
}

export function renderText(report: RunReport): string {
  const lines: string[] = [];
  for (const s of report.scenarios) {
    lines.push(`[simulator] running: ${s.name}`);
    if (s.error) {
      lines.push(`  FAIL scenario aborted: ${s.error}`);
      continue;
    }
    for (const step of s.steps) {
      const mark = step.pass ? 'PASS' : 'FAIL';
      lines.push(`  ${mark} ${step.name}${fmt(step.detail)}`);
    }
    const tag = s.pass ? 'PASS' : 'FAIL';
    lines.push(`${tag} ${s.name} in ${(s.durationMs / 1000).toFixed(1)}s`);
  }
  const passed = report.scenarios.filter((s) => s.pass).length;
  const total = report.scenarios.length;
  lines.push('');
  lines.push(`[simulator] ${passed}/${total} scenarios passed`);
  return lines.join('\n');
}

export function renderJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}

export function summarize(report: RunReport): { allPass: boolean } {
  const allPass = report.scenarios.every((s) => s.pass);
  return { allPass };
}
