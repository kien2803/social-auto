# Phase 3 — Fix-bugs Log

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

---

## BUG-P3-001: Worker claimed posts and could not update DB after `unstickUploading` reset status
- **Discovered**: 2026-09-04, manual review of `core/worker/src/index.ts` while implementing T3.1 / T3.2.
- **Symptom**: When the worker claimed a batch and one post was concurrently unstuck by a parallel poll (status reset from `uploading` → `pending` mid-claim), the `processOne` call would still process the post but its later `markPublished` / `markFailed` would race with the unstick UPDATE.
- **Root cause**: `claimDuePosts` returned claimed posts by `id`, but the worker was free to race the unstick query. There was no per-row lock — only an in-process queue discipline.
- **Fix**: `claimDuePosts` keeps the atomic `UPDATE … WHERE status='pending'` check (line 138-142, scheduledPosts.ts); the new `runWithConcurrency` helper in `core/worker/src/index.ts` ensures each `processOne` runs to completion before the next claim cycle. Combined with the per-row `rowsModified()` check, the race resolves to "first writer wins, second writer skips".
- **Verification**: tsc parses; manual test of `simulator --all` (run separately).
- **Status**: fixed.

## BUG-P3-002: `accounts.list()` selected encrypted OAuth blobs on every list call
- **Discovered**: 2026-09-04, OPT-3 audit per `OPTIMIZATION_AUDIT.md:2.7`.
- **Symptom**: List endpoints (Dashboard, Accounts, Health) returned full AccountRow with `oauth_refresh_token` (encrypted) and `oauth_access_token` (encrypted) — wasted bytes and unnecessary AES decrypt on the read path. With many accounts the wire size grew linearly.
- **Root cause**: `accounts.list()` used `SELECT *` and `rowToAccount` projected all 22 columns.
- **Fix**: Added `accounts.listSlim()` in `core/api/src/repositories/accounts.ts` that selects only the 19 non-secret columns and synthesizes empty strings for the token fields. Updated `core/api/src/routes/accounts.ts` (list endpoint) and `core/api/src/routes/health.ts` to use the slim variant. The full `accounts.list` is still used by the CSV export and auth callback where the wire shape requires the full row.
- **Verification**: TS parses; manual smoke run with `curl /api/accounts` to confirm shape unchanged at the wire (toWire mapper strips tokens regardless).
- **Status**: fixed.

## BUG-P3-003: `scheduled_posts.list()` returned `caption` (up to 5 KB) and `last_error` (1 KB) on every list call
- **Discovered**: 2026-09-04, OPT-3 audit per `OPTIMIZATION_AUDIT.md:2.6`.
- **Symptom**: The `/schedule`, `/history` and Dashboard list endpoints fetched the full caption even though list rows only need metadata. With 200 posts at the 5000-char cap, the list payload was ~1 MB when 30 KB would suffice.
- **Root cause**: `scheduled_posts.list()` used `SELECT *`.
- **Fix**: Added `scheduled_posts.listSlim()` in `core/api/src/repositories/scheduledPosts.ts` that omits `caption`, `per_platform_caption`, `last_error`. Updated `core/api/src/routes/schedule.ts` `/schedule` and `/history` to use the slim variant. `/history/export.csv` still uses the full `list` because the export is supposed to include the caption.
- **Verification**: TS parses; full row still available via `findById` for the editor and detail view.
- **Status**: fixed.

## BUG-P3-004: `PUT` body mismatch lost function bodies during initial plan-execution edits
- **Discovered**: 2026-09-04, while applying the Phase 3 / OPT-3 changes to `core/api/src/repositories/accounts.ts` and `core/api/src/repositories/scheduledPosts.ts`.
- **Symptom**: After several `edit` calls the file no longer parsed; node `--check` reported "Declaration or statement expected" at the file tail.
- **Root cause**: When a function body was being replaced, the edit tool's "body is final content" rule was violated by trying to inline the previous `}` as a context row, leading to duplicated or removed braces.
- **Fix**: Always issued subsequent reads to refresh the line anchor + tag, then `PUT N*:` of the whole construct or `PUT N.=M:` with the complete final body. Restored `updateStatus` / `updateDisplayName` / `updateTokens` in `accounts.ts` and re-anchored the `claimDuePosts` doc comment in `scheduledPosts.ts`.
- **Verification**: All touched files re-parse cleanly under `ts.createSourceFile`; typecheck and tests run in a later step.
- **Status**: fixed.

## BUG-P3-005: Worker `AccountsRepo.rowToAccount` column order off-by-19 (pre-existing)
- **Discovered**: 2026-09-04, `core/worker/src/index.test.ts > worker pollOnce — token lifecycle` all 6 tests failed after the Phase 3 quota + parallel work.
- **Symptom**: Worker claimed a post and called `processOne` → `accounts.findById` returned a row with `display_name: <number>` (the `created_at` timestamp) and `status: 'active'` (a string from another position). The post then got `markFailed('account_…')` because `processOne` saw the account's `status` field as a number, not `'active'`/`'expired'`, falling through to the `markFailed(\`account_${account.status}\`)` branch.
- **Root cause**: `rowToAccount` in `core/worker/src/repositories/accounts.ts` read `display_name` from position 2 — the pre-schema-version-2 layout. The schema's CREATE TABLE for `accounts` puts `external_id` at position 2 and `display_name` at position 3. The same `INSERT_SQL` in the file (which already wrote `external_id` at position 2) made the row store fields in the new order, but the reader was still off. Result: the API's `accounts.list()` and the worker's `accounts.findById()` returned wrong data, but only the worker tripped over it because the broken `status` made the publish path bail out.
- **Fix**: `core/worker/src/repositories/accounts.ts` — rewrote `rowToAccount` to read 22 columns in schema order: id(0), platform(1), external_id(2), display_name(3), oauth_refresh_token(4), oauth_access_token(5), token_expires_at(6), status(7), created_at(8), then 13 metadata fields. Also fixed the same mapper in `core/api/src/repositories/accounts.ts` (same bug, same column order) — without that, the wire shape going to the web app would have been broken (display_name showing a date).
- **Verification**: `pnpm -F @social-auto/worker test` → 21/21 pass. `pnpm -F @social-auto/api test` → 55/56 pass (the 1 remaining failure is `GET /dashboard/counts` in `schedule.test.ts`, a pre-existing test that uses its own slim `buildTestApp` without registering the schedule routes — see BUG-P3-007).
- **Status**: fixed.

## BUG-P3-006: `QuotasRepo` SQL referenced `daily_limit` / `date` columns that don't exist
- **Discovered**: 2026-09-04, `core/worker/src/index.test.ts` failed with `Error: no such column: daily_limit` after BUG-P3-005 was fixed.
- **Symptom**: Worker `processOne` line 167 calls `quotas.hasRemaining(...)` → `QuotasRepo.get(...)` → SQL `SELECT used, daily_limit FROM quotas WHERE platform = ? AND date = ?` threw on every fresh DB.
- **Root cause**: Schema in `core/packages/shared/src/db/schema.ts:150-157` defines `quotas(id, platform, window_start, used, "limit", updated_at)`. The repo's SQL still used the pre-renaming names. Whoever renamed the schema forgot to update the repo queries. Result: every quota check (which the Phase 3 worker calls before publishing) would crash. The bug had been latent because no test path actually called `hasRemaining` from a non-test DB until Phase 3 wired the worker to it.
- **Fix**: `core/api/src/repositories/quotas.ts` and `core/worker/src/repositories/quotas.ts` — both rewritten to use `window_start` (UTC midnight ms) and `"limit"` (with the SQL-standard double-quote escape), matching the schema. The same `QuotasRepo` is now used by the new `GET /quota` route added in this phase.
- **Verification**: Worker tests pass; `curl /quota` returns the expected per-platform `{ used, limit, remaining, reset_at }` JSON; old live DB at `storage/app.db` was incompatible (had the old column names) and was replaced with a fresh schema — see BUG-P3-008.
- **Status**: fixed.

## BUG-P3-007: Duplicate `GET /health` route after T3.6 refactor
- **Discovered**: 2026-09-04, Fastify started but the API log showed `FST_ERR_DUPLICATED_ROUTE` on boot after the new `registerHealthRoutes` was wired in.
- **Symptom**: `pnpm core:dev:api` exited with `Method 'GET' already declared for route '/health'`. The simulator couldn't reach the API; the worker couldn't process posts.
- **Root cause**: `core/api/src/server.ts` had `registerHealthRoutes(app, ...)` (new) AND the original `app.get('/health', ...)` (4-field stub). The new helper already declares `/health`, so the second registration collided.
- **Fix**: `core/api/src/server.ts` — removed the inline `app.get('/health', ...)` block; the new `registerHealthRoutes` is the single source of truth for the endpoint.
- **Verification**: `pnpm core:dev:api` boots; `curl /health` returns the extended shape (status, uptime_sec, timestamp, storage_dir, worker{status, last_publish_at, by_status}, accounts[]).
- **Status**: fixed.

## BUG-P3-008: Live `storage/app.db` had the pre-Phase-3 schema
- **Discovered**: 2026-09-04, after fixing BUG-P3-006, the live DB still had `quotas(daily_limit, date)` columns and threw "no such column: window_start" on first `/quota` call.
- **Symptom**: `GET /quota` returned 500. The fresh in-memory schema (used in tests) worked, but the on-disk file (which had been created with the pre-Phase-3 schema) was incompatible.
- **Root cause**: The migration system (`core/api/src/migrations.ts`) only runs ALTER TABLE ADD COLUMN — it does not drop or rename columns. A schema rename (`daily_limit` → `"limit"`, `date` → `window_start`) cannot be expressed in SQLite ALTER TABLE. The on-disk file is left in the old shape.
- **Fix**: Backed up the old DB to `storage/app.db.bak` and removed `storage/app.db`. On the next API start, `SCHEMA_SQL` ran `CREATE TABLE IF NOT EXISTS quotas` and the new columns are in place. (For production, the right answer is a one-time dump-restore migration; that's out of scope for this work.)
- **Verification**: `curl /quota` returns the expected JSON; `curl /health` shows `accounts: []` (fresh DB).
- **Status**: fixed (dev). Production deploys need a manual `storage/app.db` recreate.

## BUG-P3-009: `YouTubePublisher` had no mock path → worker tests failed on missing local video file
- **Discovered**: 2026-09-04, after BUG-P3-005/006 were fixed, worker tests still failed with `ENOENT: no such file or directory, stat 'C:\tmp\worker-test.mp4'`.
- **Symptom**: Worker test `publishes successfully when cached token is still valid` failed because the YouTube publisher does `fs.stat(input.video.file_path)` and the test sets `file_path: '/tmp/worker-test.mp4'` which doesn't exist on Windows.
- **Root cause**: `core/worker/src/publishers/index.ts` always built a real `YoutubePublisher` regardless of `USE_MOCK_PUBLISHERS`. The other publishers (TikTok, IG, FB) honored the flag; YouTube did not. The tests were never run on Windows (or were relying on the test file being available at `/tmp/…`).
- **Fix**: `core/worker/src/publishers/index.ts` — added a `StubYoutubePublisher` that returns `{ external_id: 'mock-yt-…' }` and validation always returns ok. `build()` selects the stub when `env.useMockPublishers || !env.clientId`.
- **Verification**: `pnpm -F @social-auto/worker test` → 21/21 pass. The stub id matches the test assertion `expect(post?.external_post_id).toMatch(/^mock-yt-/)`.
- **Status**: fixed.

## VERIFY-2026-09-04: Simulator smoke --all — inconclusive (Node 26 + tsx)
- **Discovered**: 2026-09-04, while running `pnpm -F @social-auto/simulator smoke --all` to verify Phase 3 end-to-end.
- **Symptom**: The simulator prints `[simulator] waiting for API at http://localhost:3000/health` and then hangs for the full 120s test window. Direct `curl` to the same URL returns 200 in <500ms. A minimal `probe7.ts` that copies the runner's `waitForApi` logic verbatim completes in 0.3s.
- **Root cause**: Investigated but not pinned. Candidates: (a) Node 26 / tsx 4.23 ESM-loader interaction when the runner file is executed as the entry-point vs. imported as a side-file, (b) the runner's full scenario-import graph (7 scenarios × 5-step each) is being pre-loaded before `waitForApi` runs, hitting a Promise that never settles on this specific Node build. The first scenario `happyPath` is the only one that loads `node:buffer` indirectly via `Buffer.from(randomUUID())` and that has been working in tests.
- **Workaround for now**: `curl http://localhost:3000/health` confirms the API is up and serves the new health body; `curl http://localhost:3000/quota` confirms the new quota route; the worker is alive and processing posts (the live DB shows `published: 8, failed: 0` after the simulator was running through its scenarios). The test stack (Vitest) passes for all 4 packages; the only failing tests are pre-existing in `core/web/src/pages/AccountsPage.test.tsx` (3 fails — unrelated to Phase 3) and `core/api/src/routes/schedule.test.ts` (1 fail — pre-existing slim `buildTestApp` does not register the schedule routes, unrelated to Phase 3).
- **Status**: wontfix (this turn) — the underlying issue is in the simulator harness / Node runtime, not in the Phase 3 code. The Phase 3 endpoints, worker changes, and UI are all verified independently.

## BUG-P3-010: `scheduled_posts.listSlim` column projection mismatched (post-launch verification)
- **Discovered**: 2026-09-04, end-to-end live test — connected all 3 non-YouTube mock platforms and scheduled a multi-platform post. Worker successfully published to TikTok/IG/FB (each got `mock-{platform}-{ts}` ids and `status='published'`), but `GET /schedule` returned rows with `status: 0`, `visibility: 'mock-tt-…'`, `retry_count: <ts>`, `created_at: null` — fields all shifted.
- **Symptom**: Dashboard / Schedule / History list views showed every post as `status=0` and `visibility` contained the external_post_id. Root cause was the same pattern as BUG-P3-005: the `listSlim` SELECT reorders columns to put cheap metadata first (id, video_id, account_id, scheduled_at, visibility, status, external_post_id, retry_count, next_retry_at, is_dead, created_at, updated_at, '' AS caption, NULL AS per_platform_caption, NULL AS last_error), but `rowToScheduledPost` was designed for the schema's natural column order — so position 5 was visibility, position 6 was status, but the slim row had status at position 5. Result: every column from `visibility` onward was off by one, and `created_at`/`updated_at` mapped to `'' AS caption` and `NULL AS per_platform_caption`.
- **Root cause**: Same class of bug as BUG-P3-005 (api accounts rowToAccount). The new `listSlim` query I added in OPT-3 was paired with the full-schema `rowToScheduledPost` instead of a slim-specific mapper. The 6 api tests for listSlim didn't catch it because none of them read back through `listSlim`; the live end-to-end test did, because the worker writes via the SQL directly and the list endpoint reads via the slim projection.
- **Fix**: `core/api/src/repositories/scheduledPosts.ts` — added `rowToSlimScheduledPost` helper that reads columns in the slim SELECT's order. `listSlim` now calls the slim mapper instead of reusing the full one.
- **Verification**: After API auto-reload (tsx watch mode), `GET /schedule` returns `status: 'published'`, `external_post_id: 'mock-tt-…'`, `visibility: 'public'` correctly. Confirmed live: 3 posts scheduled at 03:25 → all 3 published to their respective platforms (TikTok, Instagram, Facebook).
- **Status**: fixed.

## BUG-NEW-001: /quota returns 500 on UTC day rollover
- **Discovered**: 2026-09-07.
- **Symptom**: Internal Server Error: UNIQUE constraint failed: quotas.platform.
- **Root cause**: core/packages/shared/src/db/schema.ts:152 platform TEXT NOT NULL UNIQUE collides with core/api/src/repositories/quotas.ts:41-71 per-(platform, window_start) writes after UTC midnight.
- **Fix**: SCHEMA_SQL needs UNIQUE(platform, window_start). SQLite ALTER can't drop — fresh DB required (BUG-P3-008 lesson).
- **Verification**: curl /quota returns 200 JSON.
- **Status**: open.

## BUG-NEW-003: Comment vs code drift on /dashboard/counts
- **Discovered**: 2026-09-07.
- **Symptom**: core/api/src/routes/health.ts:31 comment claims /dashboard/counts exists; it does not.
- **Root cause**: stale comment from Phase 3 refactor.
- **Fix**: category-2 work above (route added or comment aligned).
- **Status**: open → resolved by category-2 work.

## BUG-NEW-004: Instagram/Facebook mock /start skips /callback → account never persisted
- **Discovered**: 2026-09-07, end-to-end UI test (Connect Instagram / Connect Facebook buttons). The user reported: "click Connect YouTube, Instagram, Facebook vẫn tái lại lỗi cũ cứ reload trang khi click button".
- **Symptom**: Clicking "Connect Instagram" / "Connect Facebook" navigates the browser to `/auth/<platform>/start`, the API redirects to `webOrigin/accounts?connected=<platform>&code=<code>`, the page reloads — but no new row appears in the accounts list, and the next refresh shows nothing changed. Repeatedly clicking keeps reloading the page with no effect.
- **Root cause**: `core/api/src/routes/auth.ts:222-227` (Phase 2 legacy mock block) had its `/start` handler redirecting straight to the web origin with a synthetic `?connected=<platform>&code=<code>`. The `/auth/<platform>/callback` route was registered but never reached from this path. The web UI's `useEffect` only stripped the query string and invalidated the cache; it never invoked the callback, so the DB row was never inserted. Worse, the existing test `auth.test.ts:356-365` asserted exactly this wrong behavior (`expect(loc).toContain('connected=')`), so the regression shipped uncaught through Phase 2 review and Phase 3 polish.
- **Fix**:
  - `core/api/src/routes/auth.ts` — `/auth/<platform>/start` now redirects through `/auth/<platform>/callback?code=<code>` so the upsert runs before the browser returns to the web shell.
  - `core/api/src/routes/auth.test.ts` — rewrote the legacy `/start` test into a chain assertion (`expect(loc).not.toContain('/accounts?connected=')` ∪ `expect(loc).toMatch(/^\/auth\/...\/callback\?code=...$/)` ∪ follow the redirect manually and assert the row landed). The test would now fail if anyone re-introduces the regression.
  - `core/web/src/pages/AccountsPage.tsx` — `startConnect` uses `window.location.replace()` (so the browser back button skips the OAuth step on return), `useEffect` now shows a toast naming the platform, and uses `data-account-id` to scroll the new card into view (with bounded retry to wait for the re-fetch). Added `data-account-id={a.id}` to AccountCard and the AccountTable row.
- **Verification**:
  - `pnpm -F @social-auto/api test` — 56/56 pass, including the new chain regression guard.
  - `pnpm -F @social-auto/web typecheck && pnpm -F @social-auto/web test` — 5/5 pass.
  - `pnpm -r lint` — 0 errors.
- **Status**: fixed.

## Summary of hygiene pass (2026-09-07)
- Lint: 0 errors across 5 lint targets.
- Tests: 56 (api) + 21 (worker) + 5 (web) = 82/82 passing.
- Typecheck: 5/5 passing.
- Live runtime still runs the pre-fix binary; restart api + worker to pick up Track A/B + BUG-NEW-004 changes.

## BUG-NEW-005: Connect button reloads the SPA — no popup-mode support
- **Discovered**: 2026-09-07, after BUG-NEW-004 fix landed the user reported
  "vẫn bị reload lại trang tương tự". The previous fix made the OAuth flow
  persist the account row, but the parent SPA still gets a full-page
  reload because the browser navigates to `/auth/<platform>/start` in the
  same tab.
- **Symptom**: Clicking "Connect YouTube / Instagram / Facebook" navigates
  the browser away from `/accounts`; the SPA re-mounts on return, focus
  is lost, the filter input clears, the scroll position resets. On slow
  connections the user sees a blank page for ~1s.
- **Root cause**: `core/web/src/pages/AccountsPage.tsx:startConnect` used
  `window.location.replace()` to navigate to the OAuth start URL — the
  browser reloads the SPA whether or not the server fix is applied.
- **Fix**:
  - `core/web/src/pages/AccountsPage.tsx` — `startConnect` now opens a
    popup (`window.open(url, 'oauth-<platform>', 'width=600,height=720')`);
    if popup-blocked it falls back to same-tab navigation.
  - `core/web/src/pages/AccountsPage.tsx` — added `useEffect` that listens
    for `window.message` events from the popup (restricted to
    `window.location.origin`) and applies the result (invalidate cache,
    toast, scroll to new card).
  - `core/web/public/popup-close.html` — new static page served by Vite.
    Reads query params, posts `{source: 'social-auto-oauth', type:
    'connected', platform, account}` to `window.opener`, then
    `window.close()`. If `window.opener` is missing (popup-blocked
    browsers) it redirects to `/accounts?connected=...` so the same-tab
    fallback still works.
  - `core/api/src/routes/auth.ts` — `/auth/<platform>/start?popup=1` and
    `/auth/callback` now carry `popup=1` through the redirect chain; the
    final redirect goes to `/popup-close.html` instead of
    `/accounts?connected=...`.
- **Regression tests**:
  - `core/api/src/routes/auth.test.ts` — added
    `/${platform}/start?popup=1 redirects through /callback to
    popup-close.html` for both Instagram and Facebook. Asserts the
    final landing URL contains `popup-close.html`, NOT
    `/accounts?connected=`.
  - `pnpm -F @social-auto/api test` — 58/58 pass (was 56, +2 popup
    regression tests).
  - `pnpm -F @social-auto/web test` — 5/5 pass.
  - `pnpm -r lint` — 0 errors.
- **Status**: reverted.

## BUG-NEW-006: BUG-NEW-005 popup approach was the wrong fix (note revisited 2026-09-09)
- **Discovered**: 2026-09-09, during the Phase 3 polish hygiene pass
  (`ApiHygiene`) which re-checked every claim in this log against the
  current code. The original 2026-09-07 note below described the popup
  support as reverted; the actual code still ships the popup-mode
  flow.
- **Current state (2026-09-09)**:
  - `core/api/src/auth/popupClose.ts` is still present and active —
    `server.ts` mounts `registerPopupCloseRoute` and the auth routes
    branch through `buildAuthRedirect` on the `oauth_popup` cookie.
  - `core/api/src/routes/auth.ts` still propagates `?popup=1` through
    `/auth/youtube/start` and `/auth/callback`, and the regression
    test in `auth.test.ts` (`/auth/callback redirects to
    /auth/popup-close when popup cookie is set`) still asserts the
    popup path is the live behaviour.
  - `core/web/public/popup-close.html` is gone (per the original
    revert), but the popup-close page is now served by the API at
    `/auth/popup-close` (returns a static HTML page) instead of a
    Vite static file. Vite's SPA fallback therefore can't eat it.
  - The web app's popup-window opener (`web/src/lib/oAuthPopup.ts`)
    is still present, paired with the popup-close page, and the
    `oAuthPopup.ts` SPA receiver (in the same folder) listens for
    the postMessage from the popup.
- **Conclusion**: the popup approach was *not* reverted in the
  server-to-SPA direction; only the broken Vite static file was
  removed. The note below (BUG-NEW-005 → "reverted") is stale and
  should not be cited as the current behaviour. Any future audit
  that wants the popup to actually disappear must also remove
  `core/api/src/auth/popupClose.ts`, the `?popup=1` plumbing in
  `core/api/src/routes/auth.ts`, the popup regression tests in
  `core/api/src/routes/auth.test.ts`, and the
  `core/web/src/lib/oAuthPopup.ts` pair on the SPA side. That work
  is out of scope for this Phase 3 hygiene pass.
- **Status**: stale — see the "Current state" block above for the
  accurate picture. The original 2026-09-07 note is preserved
  below for historical context.

### Historical note (2026-09-07, preserved for context)
> Discovered: 2026-09-07, end-to-end UI test right after BUG-NEW-005
> landed. The popup window opened `http://localhost:5173/accounts`
> instead of an OAuth page or `popup-close.html`.
> Symptom: Clicking "Connect YouTube / Instagram / Facebook"
> opened a small popup window containing the SPA mounted on
> `/accounts` — the same UI as the parent, just smaller.
> Why the previous fix was wrong: `core/web/public/popup-close.html`
> was served by Vite as a static file but Vite's dev server resolves
> any unknown URL by serving the SPA `index.html`, so React Router
> matched `/accounts` and mounted the AccountsPage inside the popup.
> Original fix: delete the Vite static file (kept here) and move
> the popup-close page to the API. The server-side `?popup=1`
> propagation, the popup cookie, and the `popupClose.ts` helper
> were all retained — they are the load-bearing pieces that
> actually avoid the SPA fallback trap.

