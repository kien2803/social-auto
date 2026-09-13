# @social-auto/simulator

Smoke test runner for the social-auto pipeline. Drives the live API + worker as an
external HTTP client — no core changes. Runs scenarios that exercise happy paths
and known failure modes end-to-end.

## Prerequisites

The API and worker must already be running in mock mode:

```bash
USE_MOCK_GOOGLE=true USE_MOCK_PUBLISHERS=true pnpm dev
```

In another terminal:

```bash
pnpm -F @social-auto/simulator smoke          # default scenario
pnpm -F @social-auto/simulator smoke --all    # all 5 scenarios
pnpm -F @social-auto/simulator smoke happyPath
pnpm -F @social-auto/simulator smoke --json
```

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `API_BASE_URL` | `http://localhost:3000` | API endpoint |
| `SIM_TIMEOUT_MS` | `120000` | Per-scenario timeout |

## Scenarios

| Name | Verifies |
|------|----------|
| `happyPath` | connect account → upload video → schedule → worker publishes |
| `retryFlow` | transient failure → succeeds on retry |
| `quotaExceeded` | worker marks failed, no infinite retry |
| `concurrentClaim` | N posts at the same time → atomic claim |
| `invalidVideo` | bad mime rejected before upload |

## Output

```
[simulator] running: happyPath
  PASS connect mock YouTube account
  PASS upload video (10s, 1024 bytes)
  PASS schedule post for +5s
  PASS worker published within 60s
PASS 1/1 in 12.3s

Exit code 0 = all pass, 1 = any fail.
```
