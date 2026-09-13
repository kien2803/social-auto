## BUG-004: SQLite not persisted to disk on close
- **Discovered**: T0.3 test "Refresh token persists across app restart", 2026-08-27.
- **Symptom**:
  ```
  AssertionError: expected false to be true
  expect(fs.existsSync(tmp)).toBe(true);  // file not written
  ```
- **Root cause**: `db.ts` used a `dirty` flag that wasn't always set correctly because the wrapper intercepted only some write paths, and `close()` only flushed when `dirty === true`. Combined with Fastify's lifecycle ordering, the close hook could run before the file write completed or skip the persist if dirty was incorrectly false.
- **Fix**: Removed the `dirty` flag — persist after every `run`/`exec` call when path is not `:memory:`. Added explicit `flush()` method.
- **Verification**:
  - [x] All 8 OAuth tests pass, including "Refresh token persists across app restart".
- **Status**: fixed.


## BUG-005: Vite dev proxy intercepts React Router paths
- **Discovered**: 2026-09-03, user-reported "lỗi reload trang".
- **Symptom**: Reloading any non-root route (`/schedule`, `/history`, `/dashboard`, `/accounts`, …) returns raw JSON instead of the SPA shell. Same problem for direct URL paste / bookmark. Navigation inside the app (React Router pushState) still works.
- **Root cause**: `core/web/vite.config.ts` proxied path-prefixes that overlap with React Router:
  ```ts
  proxy: {
    '/api': forwardToApi({ stripApiPrefix: true }),
    '/auth': forwardToApi(),
    '/videos': forwardToApi(),
    '/schedule': forwardToApi(),
    '/history': forwardToApi(),
    '/dashboard': forwardToApi(),
    '/health': forwardToApi(),
  }
  ```
  On full-page navigation, Vite matches `/schedule` against the `/schedule` proxy entry and forwards the GET to the API, which returns its 200 JSON list. The HTML shell is never served.
- **Fix**: Only proxy `/api/*`. All other paths must reach Vite's SPA fallback. The web's OAuth start redirect at `core/web/src/pages/AccountsPage.tsx:startConnect` now uses `/api/auth/<platform>/start` to stay consistent with the proxy surface.
- **Verification**:
  - [x] `curl http://localhost:5173/schedule` returns the SPA HTML shell, not JSON.
  - [x] Reload `/accounts` in the browser keeps the React app mounted.
  - [x] Click "Connect YouTube" still triggers OAuth (mock or real, depending on env).
- **Status**: fixed.
---