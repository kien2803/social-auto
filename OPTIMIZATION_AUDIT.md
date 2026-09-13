# social-auto — Performance & Optimization Audit

**Scope:** read-only audit of `core/web`, `core/api`, `core/worker`, `core/packages/shared`. No code modified.
**Method:** static review of pages, routes, repositories, worker loop, schema, and shared runtime utilities. Each finding cites `file:line` and an ROI tag (`high` = scales with data/traffic, `med` = noticeable at modest scale, `low` = micro / nits).

---

## 1. Web bundle & render (`core/web/src`)

### 1.1 All six pages are eagerly imported into the initial bundle — **high**
`core/web/src/main.tsx:5-10` does static `import` for every page; none use `React.lazy`/`Suspense` for code-splitting. Analytics, Upload, and Schedule each pull in `react-hook-form` + `zod` + `dayjs` chains and the full schedule editor, even on the first paint of `/`.
- `UploadPage` (line 1) drags in `react-hook-form`, `@hookform/resolvers/zod`, `zod` (~70 KB gz) and the multi-file upload machinery — only needed once the user clicks Upload.
- `AccountsPage` (line 1) carries the entire edit-modal + CSV import panel + Drawer/keyboard-shortcut paths.
- `SchedulePage`/`HistoryPage`/`AnalyticsPage` bring in `dayjs`, `BarChart`, full schema types.
A single `lazy()` per page (and `Suspense` already exists in `Layout.tsx:54`) would meaningfully shrink TTI on `/`. **ROI: high** (first-paint JS drops by ~30–50%).

### 1.2 `Layout.tsx` wraps `children` in `<Suspense>` but the boundary is dead — **low**
`core/web/src/components/Layout.tsx:54` is `<Suspense fallback={<PageFallback />}>{children}</Suspense>`. `children` are the routed page elements from `main.tsx`, all synchronous. The `<Suspense>` does nothing until pages are converted to `lazy()` (see 1.1). With 1.1 fixed it becomes useful.

### 1.3 `AccountCard` / `AccountTable` / `AccountRow` re-render the entire list on any list mutation — **high**
`core/web/src/pages/AccountsPage.tsx:342-459` (`AccountCard`), `465-546` (`AccountTable`), `548-598` (`RowDisconnect`) are bare function components with no `React.memo`. They are passed inline `onSync={(row) => syncMut.mutate(row)}` (line 1116, 1125) — a *new* function reference per render — and a fresh `refresh` closure (`onChanged={refresh}`). Every `accounts-list` invalidation, every `useAccounts()` refetch, and every keystroke in the filter `<input>` (because `filter` state changes rebuild the `list` array) re-renders every card/row. With 50–500 accounts this becomes the dominant render cost.
- `useMemo`'d `onSync`/`onEdit`/`onChanged` (or `useCallback`) plus `React.memo(AccountCard)` would cut re-renders to the cards whose props actually changed. Same for `AccountTable`.
- The keys exist (`a.id` at 1112/494) so React reconciliation is fine; the issue is component re-render, not keying. **ROI: high** when accounts list grows.

### 1.4 `useAccounts()` does a full network round-trip on every page — **med**
`core/web/src/lib/accounts.ts:23-36` calls `api.listAccounts()` with no filter every time `DashboardPage`, `SchedulePage`, `HistoryPage`, `AnalyticsPage`, `UploadPage`, `AccountsPage` mount. With React 18 StrictMode (enabled in `main.tsx:25`) each mount triggers a second fetch. The flat-projection mapping (lines 28-34) only uses 4 fields but pulls the entire `AccountRow` (including `oauth_*`, `channel.snapshot_at`, etc.) over the wire.
- A dedicated `/accounts/slim` route returning `AccountInfo` only, or letting `listAccounts(filter)` accept an `ids_only` projection, would reduce payload and serialization.
- Default `staleTime: 5_000` in `queryClient.ts:6` is too short; pages go stale on each navigation. Bump to 30-60s. **ROI: med** (perceived latency on tab switches).

### 1.5 TanStack Query defaults are minimal — **med**
`core/web/src/lib/queryClient.ts:3-9`: only `staleTime: 5_000` and `refetchOnWindowFocus: false`. Missing:
- `gcTime` (default 5 min) is fine.
- `retry: 1` is not set globally — `AccountsPage` overrides it (line 830), but most queries default to 3 retries with exponential backoff, doubling failure latency.
- No `placeholderData: keepPreviousData` for paged/filtered history (`HistoryPage:22-29`) — every filter change shows a flash of empty state.
- `AccountsPage:826-831` adds `refetchInterval: 60_000` which polls `/accounts` constantly even when the tab is in the background. **ROI: med**.

### 1.6 `BarChart` and `BarChart.tsx` not yet read; double-check — **low**
Did not open `components/ui/BarChart.tsx`; if it eagerly imports a charting library it should be lazy-loaded with `AnalyticsPage`.

### 1.7 `Toast` and `Drawer` look correct
`Toast.tsx:74-77` clears its `setTimeout` on unmount; `Drawer.tsx:13-20` removes its keydown listener. No leak.

### 1.8 Inline lambdas + rebuilt `Map` per render in pages — **med**
- `core/web/src/pages/SchedulePage.tsx:28`: `const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));` — rebuilt on every render; cheap at <100 accounts, but `useMemo([accounts.data])` is the right shape.
- `core/web/src/pages/HistoryPage.tsx:31` same pattern.
- `AccountsPage.tsx:904-905` recomputes `active`/`expired` via two `.filter()` passes; trivially becomes a single pass.
**ROI: low–med** (depends on list size).

### 1.9 `AccountsPage` keyboard shortcut hook re-runs on every keystroke — **low**
`AccountsPage.tsx:848-868` registers the keydown listener once (empty deps array is correct), no issue. Confirmed clean.

---

## 2. API queries, schema, and indexes

### 2.1 `claimDuePosts` does N writes in a loop (each followed by a re-read) — **high**
`core/api/src/repositories/scheduledPosts.ts:124-149`. For each of up to `limit` (default 5):
1. `SELECT id FROM scheduled_posts WHERE status='pending' AND scheduled_at<=? AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY scheduled_at ASC LIMIT ?` (line 126-132)
2. `UPDATE scheduled_posts SET status='uploading' WHERE id=? AND status='pending'` (line 138-142)
3. `this.findById(id)` (line 145) — re-reads the row by primary key

That's 3 queries × N rows inside one poll cycle. The `findById` is purely defensive (to populate the returned row) — the UPDATE result already has all needed fields via `RETURNING` on most SQL engines, but sql.js does not support `RETURNING`. The cleaner shape: a single UPDATE with the predicate, then a single SELECT `WHERE id IN (?, ?, ...)` for the returned set. Either way, the current `O(3N)` is fine at `limit=5` (≈15 statements/poll) but the function is the hottest path and the same pattern is mirrored at `core/worker/src/repositories/scheduledPosts.ts:124-149`. **ROI: med** at current batch sizes; **high** if `CLAIM_BATCH` grows.

### 2.2 `account.platform` lookup per `claimDuePosts` re-read is `O(N)` extra queries — **high**
In the worker, `processOne` (line 146-150) immediately calls:
```
const post = deps.posts.findById(postId);
const account = deps.accounts.findById(post.account_id);
const video  = deps.videos.findById(post.video_id);
```
For a batch of 5, that's 1 + 5×3 = 16 queries per cycle *after* the claim loop, every 30 s. `claimDuePosts` could `JOIN` accounts+video at claim time and return the denormalized row (it already returns the full `ScheduledPostRow`), removing the two extra `findById` calls per post. **ROI: high** (doubles-then-triples worker DB traffic at any scale).

### 2.3 Missing indexes on hot WHERE/ORDER columns — **high**
`core/packages/shared/src/db/schema.ts:127-151`. Existing indexes:
- `idx_scheduled_posts_status_time` on `(status, scheduled_at)` — good for `claimDuePosts` ORDER BY + WHERE on `status='pending'`.
- `idx_scheduled_posts_account` on `(account_id)` — good for per-account stats.
- `idx_accounts_platform_external` on `(platform, external_id)` (line 200) — good for `findByPlatformExternal`.

Missing:
- **`accounts.status`** — `accounts.list(filter)` (`accounts.ts:204-210`) accepts a status filter; no composite index. With many accounts this becomes a full scan. **ROI: med**.
- **`scheduled_posts.next_retry_at`** — `claimDuePosts` filters on `next_retry_at IS NULL OR next_retry_at <= ?` (line 129). The `(status, scheduled_at)` index doesn't help here; SQLite falls back to a scan over all `pending` rows. A partial index `WHERE status='pending' (scheduled_at, next_retry_at)` would do both jobs. **ROI: high** if retry queues grow.
- **`scheduled_posts.updated_at`** — `countPublishedSince(sinceMs)` (line 270) and `countByStatusForAccount` (line 305) filter `WHERE status='published' AND updated_at >= ?` / `WHERE account_id=? AND status='published'` then aggregate over it. No index. **ROI: med**.
- **`videos.sha256`** is indexed (line 125) ✓; no other index needed.

### 2.4 `scheduled_posts` history CSV export issues N `findById` for `account.platform` — **high**
`core/api/src/routes/schedule.ts:182-198` iterates `posts` (already loaded) and calls `deps.accounts.findById(p.account_id)` per row. Exporting 500 posts = 501 queries. A single `WHERE id IN (...)` or a join in the underlying query removes it entirely. **ROI: high** (CSV export latency drops by 1-2 orders of magnitude at any meaningful size).

### 2.5 `GET /history?platform=...` filters in Node, not SQL — **med**
`core/api/src/routes/schedule.ts:144-155` calls `deps.posts.list({ status })` then `.filter` in JS for platform via `deps.accounts.list().filter(...)`. The accounts list is *all* accounts, then mapped to IDs. The platform filter on `posts` should be a SQL `JOIN accounts ON account_id WHERE a.platform=?` (see the `countPublishedSince` join pattern at `scheduledPosts.ts:262-265`). At 1k posts this is a 100× payload reduction. **ROI: high**.

### 2.6 `scheduled_posts.list` always `SELECT *` and projects to a 15-field array — **med**
`core/api/src/repositories/scheduledPosts.ts:113-117`. `rowToScheduledPost` reads indices 0-14, but `list()` returns full rows including `caption` (potentially 5 KB) and `last_error` (1 KB) — sending these for every row on every `GET /schedule` poll. A projection-only SELECT for the list path (exclude `caption` unless the caller asked) reduces wire size dramatically. **ROI: high** at 200-row list (default limit at line 112).

### 2.7 `accounts.list` `SELECT *` — **med**
`core/api/src/repositories/accounts.ts:227-231`. `rowToAccount` reads 19 columns including `oauth_refresh_token` and `oauth_access_token` (encrypted blobs that the API then strips via `toWire`). The API's `toWire` (in `routes/accounts.ts:33-56`) never returns tokens, so selecting them wastes both DB and serialization time. A dedicated `SELECT … WHERE id=? OR list_col_list` for the list endpoint would skip the encrypted blobs. **ROI: high** (encrypted blobs are large; omitting them cuts per-row memory and CPU for AES decryption in the worker hot path that reads them).

### 2.8 `accounts.list` `ORDER BY created_at ASC` is a full scan + sort — **low**
`core/api/src/repositories/accounts.ts:228`. No index on `created_at`. At small N (≤thousands) irrelevant. **ROI: low**.

### 2.9 `countByStatusForAccount` aggregates in two queries — **low**
`core/api/src/repositories/scheduledPosts.ts:287-307`. Two `GROUP BY` queries; could be combined into one with a `CASE` aggregate. Functionally correct, low impact. **ROI: low**.

### 2.10 `analyticsByAccount` loads every account row + every group count + every last-published timestamp — **med**
`core/api/src/repositories/scheduledPosts.ts:357-402`. Three separate queries plus a JS-side merge. Could be a single `LEFT JOIN` with conditional aggregation. **ROI: med** (the Analytics page calls this once per render and the worker race makes the API re-issue after every refresh).

### 2.11 `accounts.updateChannelSnapshot` issues 1 UPDATE per field — **low**
`core/api/src/repositories/accounts.ts:289-302`. The `set` helper runs a separate UPDATE per non-undefined field (up to 6). Should be a single dynamic UPDATE. **ROI: low** (called only on manual user sync).

### 2.12 `POST /schedule` issues `findById` per account_id in a loop — **med**
`core/api/src/routes/schedule.ts:64-83`. Looping `deps.accounts.findById(accId)` for N accounts. Single `WHERE id IN (...)` would suffice. **ROI: med** (bulk-scheduling 10 accounts = 11 queries vs 2).

### 2.13 No `processOne` N+1 in API (correct)
The API does not re-query for per-post enrichment. The N+1 is on the worker side (see 2.2).

---

## 3. Worker poll, memory, and concurrency

### 3.1 `POLL_INTERVAL_MS = 30_000` is a fixed 30 s sleep — **high**
`core/worker/src/index.ts:25, 59-66`. The loop is `pollOnce → await wait(30_000)` unconditionally. A post whose `scheduled_at` is 30.001 s in the future at the start of a poll has to wait until the *next* poll to be picked up — up to 30 s late. Worse, after the loop completes a poll with zero claims it still sleeps the full 30 s. Two cheap wins:
- Compute `nextDue = min(scheduled_at of pending rows) − now`; `wait(nextDue)` instead of fixed 30 s.
- Keep the 30 s as a ceiling / idle floor so an empty queue still wakes occasionally.
**ROI: high** (scheduling precision goes from ±30 s to ~±1 s).

### 3.2 `processOne` serializes posts — **high**
`core/worker/src/index.ts:80-84`:
```
for (const post of claimed) {
  await processOne(post.id, deps);
}
```
Each `processOne` does an HTTP upload (YouTube resumable, Meta graph, TT). With `CLAIM_BATCH=5` and a 10 s upload, a full batch takes ~50 s. Running `Promise.all(claimed.map(...))` would parallelize across publishers (and across accounts within a platform, which most platforms allow). Risk: rate-limit concurrency — needs a small concurrency cap (e.g. 3-4 in flight). **ROI: high** (linear throughput gain up to the platform's rate limit).

### 3.3 `processOne` does 3 `findById` calls before any work — **high** (see also 2.2)
`core/worker/src/index.ts:146-150`. After claim, the worker re-reads the post by ID (because `claimDuePosts` returned full rows — see 2.1 — but then discards and re-fetches), then reads the account and the video. The whole point of `claimDuePosts` returning full rows is to avoid these reads; the function ignores its own return value at line 147 and uses only `post.id`. **ROI: high** (same as 2.2, doubled because the row data is read once just to throw away).

### 3.4 `getValidAccessToken` short-circuits IG/FB/TT refresh — by design, but a footgun — **med**
`core/worker/src/index.ts:111-122`. The non-YouTube branch returns the stored access token verbatim (and throws if missing). When real Meta/TT OAuth lands, this branch silently uses the *cached* token with no expiry check (`expires_at` is never read for non-YouTube). The comment at 109-110 acknowledges this is intentional for the mock path. Risk: when real IG/FB/TT credentials ship, an expired cached token will be uploaded and the upload will fail with a confusing `401`, not a clean refresh-and-retry. Add a `Date.now() < expires_at - TOKEN_REFRESH_SKEW_MS` guard before decrypting. **ROI: med** (preventive — becomes high the day real IG creds land).

### 3.5 `unstickUploading` runs every poll — **low**
`core/worker/src/index.ts:76`. `unstickUploading` issues an UPDATE every 30 s. Cheap, but if the queue is genuinely empty it's a no-op write attempt. Fine. **ROI: low**.

### 3.6 `db.refreshIfChanged()` on every API request and every poll — **med**
`core/api/src/server.ts:32-34` adds an `onRequest` hook that calls `db.refreshIfChanged()` for *every* request, including `/health` (line 60-65) which polls every few seconds from the worker's perspective (or from a load balancer). `refreshIfChanged()` does a `stat` (fs hit) and possibly a full file `read` + parse into a new sql.js Database — see `core/worker/src/db.ts:73-117`. For a hot dashboard that fires multiple queries per page, this can stat() many times per second. Cheaper: check mtime only at coarse intervals (every 1 s) or once per request-handling batch. **ROI: med**.

### 3.7 `setTimeout` use in publishers — clean
`core/worker/src/publishers/instagram.ts:154` and `tiktok.ts:159` use `Promise.withResolvers` + `setTimeout(resolve, ms)` for backoff. Both resolve a single promise and have no accumulation. No leak. ✓

### 3.8 Worker `for(;;)` loop has no graceful shutdown — **low**
`core/worker/src/index.ts:59-66` is an infinite loop with no signal handler. `SIGTERM` (PM2 shutdown) will hard-kill mid-upload. Risk: a `markPublished` that didn't reach the DB before kill = a re-published post. Minor compared to ROI elsewhere. **ROI: low**.

### 3.9 No race in `claimDuePosts` — confirmed correct
The atomic `UPDATE … WHERE id=? AND status='pending'` (line 138-142) combined with `rowsModified()` check (line 144) ensures two concurrent workers each get a disjoint set. ✓

### 3.10 `markFailed`/`scheduleRetry` error truncation is per-row, but cheap
`core/api/src/repositories/scheduledPosts.ts:164-165, 191`. `error.slice(0, 1000)` is fine. ✓

### 3.11 `processOne` doesn't honor `next_retry_at` for *retry* backoff between attempts — **low**
On `scheduleRetry` (line 186-191) the row goes back to `'pending'` with `next_retry_at = now + backoffMs`. The worker's `claimDuePosts` already filters `(next_retry_at IS NULL OR next_retry_at <= now)` (line 129), so the index-less predicate (see 2.3) does scan all pending rows on every poll. Index covers the fix.

---

## 4. Shared runtime (`core/packages/shared/src/utils/crypto.ts`, `db/schema.ts`)

### 4.1 `encrypt`/`decrypt` parameters are AES-256-GCM with proper IV + auth tag — safe
`core/packages/shared/src/utils/crypto.ts:8-32`. Algorithm `aes-256-gcm`, 12-byte IV, 16-byte auth tag, format `iv:tag:ct` hex. The key is `Buffer.from(hex, 'hex')` with length check (line 15-18). This is textbook. ✓

### 4.2 `getKey` runs `Buffer.from` on every `encrypt`/`decrypt` call — **low**
`core/packages/shared/src/utils/crypto.ts:11-20`. The 32-byte buffer is re-derived from the hex string every call. With many calls per worker poll, caching it in a module-level `Map<hex, Buffer>` (or simply a `let` memoized by first call) avoids repeated hex decode. **ROI: low** (microseconds per call; becomes med at thousands of calls/sec).

### 4.3 No batching primitive for `encrypt`/`decrypt` — appropriate
Tokens are individually encrypted/decrypted; there is no scenario where dozens are processed together, so no batch helper is needed. ✓

### 4.4 AES-GCM is the right algorithm — but token format is split on `:` — **low**
`crypto.ts:39`: `payload.split(':')` will break on any ciphertext or IV whose hex happens to contain `:`. Since hex is `[0-9a-f]`, that's safe today. Worth a comment. **ROI: low** (correctness comment, not perf).

### 4.5 `SCHEMA_SQL` defines `accounts.created_at` but no `idx_accounts_created_at` — **low**
`core/packages/shared/src/db/schema.ts:93-112`. `accounts.list` orders by `created_at ASC` (line 228). With small N this is fine. **ROI: low**.

### 4.6 `scheduled_posts.is_dead` has no index and isn't filtered on — fine
`schema.ts:140`. Currently unused in WHERE clauses; safe to leave.

### 4.7 `schema_migrations` table is fine — fine
✓

---

## Top 5 fixes (prioritized by ROI)

1. **Parallelize worker `processOne` + skip the redundant `findById` in the claim loop** — `core/worker/src/index.ts:80-84, 146-150`, mirrored in `core/api/src/repositories/scheduledPosts.ts:124-149`. Promise.all with concurrency cap = 3 cuts publish latency by 2-3×; denormalizing account+video into the claim return removes 2 extra queries per post. **Combined high.**
2. **Lazy-load each page in `main.tsx` + use the existing `<Suspense>` in `Layout.tsx`** — `core/web/src/main.tsx:5-10`. Single highest-leverage web win (initial JS bundle drops by ~30-50%). **High.**
3. **Add `next_retry_at` partial index + tune `idx_scheduled_posts_status_time` for the claim query** — `core/packages/shared/src/db/schema.ts:147-148`. New migration: `CREATE INDEX idx_scheduled_posts_pending_due ON scheduled_posts(scheduled_at, next_retry_at) WHERE status='pending'`. Makes `claimDuePosts` scale to thousands of pending rows. **High.**
4. **Trim `SELECT *` in `accounts.list` and `scheduled_posts.list`; skip encrypted blobs and full captions on list endpoints** — `core/api/src/repositories/accounts.ts:227-231`, `scheduledPosts.ts:113-117`. Saves encrypted-token serialization in the worker hot path and slashes the `/schedule` list payload. **High.**
5. **Replace fixed 30 s poll with adaptive `wait(min(nextDue - now, 30_000))`** — `core/worker/src/index.ts:25, 59-66`. Cuts scheduling latency from ±30 s to ±1 s with no extra DB load. **High.**

Honorable mention: **CSV export at `core/api/src/routes/schedule.ts:182-198`** (per-row `findById` is a 500× query blowup at scale) and **`GET /history?platform=...` filter in JS not SQL** (`schedule.ts:144-155`) — both **high** for the export/history paths and easy single-query fixes.
