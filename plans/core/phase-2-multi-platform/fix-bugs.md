# Phase 2 — Fix-bugs Log

## BUG-XXX format

```
## BUG-XXX: <title>
- Discovered: <khi nào, test nào fail>
- Symptom: <mô tả>
- Root cause: <phân tích>
- Fix: <file:symbol thay đổi>
- Verification: <test pass, evidence>
- Status: open | fixed | wontfix
```

## BUG-P2-001: Mock multi-platform auth tokens rejected by publisher stubs
- Discovered: 2026-08-31, `simulator --all` failing on `multiPlatform` (1/7 pass).
- Symptom: After connecting 4 mock accounts via the new `/auth/<platform>/start` + `/auth/<platform>/callback` routes, the worker marked the tiktok/ig/fb posts as `failed` with `tiktok: invalid access token (stub)`.
- Root cause: The mock platform OAuth routes minted access tokens prefixed with the full platform name (`mock-tiktok-access-…`), but the publisher stub validators in `core/worker/src/publishers/{tiktok,instagram,facebook}.ts` only accept the short prefix (`mock-tt-`, `mock-ig-`, `mock-fb-`).
- Fix: `core/api/src/routes/auth.ts` — replaced `mock-${platform}-access` with a `tokenPrefix` lookup (`tt`/`ig`/`fb`) so encrypted access tokens match the stubs.
- Verification: `pnpm -F @social-auto/api typecheck` (clean), `pnpm -F @social-auto/api test` (32/32 pass), `pnpm -F @social-auto/simulator smoke --all` (7/7 scenarios pass — `multiPlatform` confirms 4 distinct platform-prefixed external_ids).
- Status: fixed

## BUG-P2-002: API + worker wrote to separate SQLite files in dev mode
- Discovered: 2026-08-31, simulator `--all` first attempt reported `multiAccount` and `multiPlatform` failed with `fetch failed`.
- Symptom: Worker never saw posts the API had inserted; happyPath/concurrentClaim showed `worker marked post pending: ...` after the worker eventually claimed.
- Root cause: `core/.env.local` sets `DATABASE_URL=../../storage/app.db`, but API and worker default CWDs differ (`core/api` and `core/worker`). Each resolved the relative `../../storage/app.db` to a different absolute path.
- Fix: invoked both processes with explicit `DATABASE_URL=C:/.../storage/app.db` and `STORAGE_DIR=...` env vars; same path for both.
- Verification: `simulator --all` 7/7 pass; worker log shows it claims and publishes posts the API inserted.
- Status: fixed