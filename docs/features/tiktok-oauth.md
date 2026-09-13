---
title: TikTok OAuth (Phase 2)
description: >-
  Connect a TikTok creator account to social-auto via TikTok Login Kit + PKCE,
  persist the refresh token encrypted at rest, and read the creator's open_id
  back from TikTok. Single TikTok account per install (multi-account lifted in
  Phase 2 plan was deferred — only one account row, keyed by `open_id`).
---

# TikTok OAuth

The second end-to-end OAuth flow shipped. Lets a user click **Add TikTok account** in the web UI, authorize the app against their TikTok creator account, and have social-auto remember them across server restarts. Phase 2 adds the upload-publish chain after the credential round-trip succeeds.

## Key features

- **One-click connect** — single button on `/accounts` runs the full OAuth + PKCE dance.
- **PKCE S256** — TikTok requires `code_challenge` + `code_challenge_method=S256` on the authorize URL and a matching `code_verifier` at the token exchange. The verifier is stored in an httpOnly cookie for the round-trip.
- **Encrypted token storage** — refresh and access tokens are stored AES-256-GCM encrypted; only the API process with `TOKEN_ENCRYPTION_KEY` can read them.
- **Persists across restarts** — SQLite file on disk; closing the server and reopening keeps the connection.
- **Mock fallback** — `USE_MOCK_TIKTOK=true` (or any of `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `TIKTOK_REDIRECT_URI` missing) routes the flow through an in-process mock that emits synthetic codes and `mock-tt-…` tokens. Lets the simulator + tests run without a TikTok partner app.
- **Popup-mode aware** — `/auth/tiktok/start` honors `?popup=1` and sets the `oauth_popup` cookie so the callback can redirect through `/auth/popup-close` (postMessage handshake with the SPA).

## How it works

The flow has three endpoints, all in `core/api/src/tiktok/authRoutes.ts`. The web app initiates; TikTok mediates; the API persists.

### 1. Start

`GET /auth/tiktok/start` — the API:

1. Generates a 16-byte hex `state`, stashes it in an httpOnly `oauth_state` cookie.
2. Generates a 32-byte PKCE `code_verifier` (base64url), stashes it in an httpOnly `oauth_pkce_verifier` cookie.
3. Computes `code_challenge = base64url(sha256(code_verifier))`.
4. If `?popup=1` is present, sets the `oauth_popup` cookie (10-min TTL) so the callback can detect postMessage mode.
5. 302-redirects the browser to `https://www.tiktok.com/v2/auth/authorize/?client_key=…&scope=user.info.basic,video.upload,video.publish&response_type=code&redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256`.

The `client_key` + `scope` + `redirect_uri` come from the configured `TiktokOAuthClient.buildAuthUrl(state, codeChallenge)`. The mock client returns the configured `TIKTOK_REDIRECT_URI` directly with a synthetic `code=mock-tt-code-N`; the real client builds the same URL with `tiktok.com` as host.

### 2. Callback

`GET /auth/tiktok/callback?code=…&state=…` — TikTok redirects back. The API:

1. Compares `state` from the query against the `oauth_state` cookie. Mismatch → **400 state mismatch**.
2. Verifies `oauth_pkce_verifier` cookie exists. Missing → **400 pkce_verifier missing** (caller must restart via `/auth/tiktok/start`).
3. Clears both cookies.
4. Calls `tiktok.exchangeCode(code, code_verifier)` → `{ access_token, refresh_token, expires_at, open_id, scope, token_type }`.
5. Encrypts both tokens with `TOKEN_ENCRYPTION_KEY`.
6. Upserts the `accounts` table: if a row with `platform='tiktok'` and `external_id=open_id` exists, update tokens; otherwise insert with `status='active'` and channel snapshot `{ avatar_url: user.avatar_url }`.
7. Redirects the browser to `${WEB_ORIGIN}/accounts?connected=tiktok&account=<id>` (popup mode goes through `/auth/popup-close`).

### 3. Worker refresh

The worker calls `tiktok.refresh(refresh_token)` from `getValidAccessToken()` ~60s before the cached access token expires. Failure → `isRevoked()` returns true → account row marked `status='expired'` → next publish marks `is_dead=1`.

## Configuration

Required environment variables:

- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` — from [developers.tiktok.com](https://developers.tiktok.com) → your app → App details.
- `TIKTOK_REDIRECT_URI` — must match a **Redirect URI** registered on the TikTok Login Kit config. Default for dev: `http://localhost:5182/auth/tiktok/callback`.
- `TOKEN_ENCRYPTION_KEY` — 64 hex chars (32 bytes). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `USE_MOCK_TIKTOK` — defaults to `true` so a fresh checkout boots without a TikTok app. Flip to `false` for real OAuth.

### One-time TikTok app setup

1. Create an app at [developers.tiktok.com](https://developers.tiktok.com).
2. Add the **Login Kit** product (Settings → Products → Add).
3. Add the **Content Posting API** product (needed for video upload in Phase 2 plan).
4. In **Login Kit → Redirect URI**, add `http://localhost:5182/auth/tiktok/callback` (match `TIKTOK_REDIRECT_URI`).
5. Request scopes `user.info.basic`, `video.upload`, `video.publish` (live apps need them approved; dev-mode apps can use them with the user as a **Tester**).
6. Fill `App icon`, `Description`, `Terms of Service URL`, `Privacy Policy URL`, **Web/Desktop URL** (HTTPS required) — see `plans/core/phase-3-polish/fix-bugs.md` for the form-validation gotchas.
7. Copy **Client Key** + **Client Secret** into `.env.local`.

### Sandbox vs Production

- **Sandbox** (`Sandbox` badge top-right) — no review needed; you add your TikTok handle as a Tester; consent screen shows a "this app is for testing" badge.
- **Production** — requires Submission for review (3–7 day queue). Once approved, any TikTok user with the relevant scopes can connect.

The mock fallback never needs an app. Set `USE_MOCK_TIKTOK=true` to test the rest of the chain (scheduler → worker → publish) without a TikTok partner app.

## Local walkthrough

1. `pnpm install`
2. `cp .env.example .env.local`, fill in `TIKTOK_*` and `TOKEN_ENCRYPTION_KEY`. Either leave `USE_MOCK_TIKTOK=true` (default) or set `false` after completing the dev-portal setup.
3. `pnpm core:dev` (runs api + worker + web in parallel).
4. Open <http://localhost:5181/accounts>.
5. Click **Add TikTok account** → TikTok consent screen → land back on `/accounts?connected=tiktok` with the new card.
6. Restart `pnpm core:dev` and reload — still connected.

## Implementation pointers

- Route handlers: [`core/api/src/tiktok/authRoutes.ts`](../../core/api/src/tiktok/authRoutes.ts)
- TikTok client interface: [`core/api/src/tiktok/client.ts`](../../core/api/src/tiktok/client.ts)
- Real client (TikTok Display API + Login Kit): [`core/api/src/tiktok/realClient.ts`](../../core/api/src/tiktok/realClient.ts)
- Mock client: [`core/api/src/tiktok/mockClient.ts`](../../core/api/src/tiktok/mockClient.ts)
- Factory that picks real vs mock: [`core/api/src/tiktok/factory.ts`](../../core/api/src/tiktok/factory.ts)
- Worker publisher: [`core/worker/src/publishers/tiktok.ts`](../../core/worker/src/publishers/tiktok.ts)
- Web UI ConnectMenu: [`core/web/src/pages/AccountsPage.tsx`](../../core/web/src/pages/AccountsPage.tsx) — `mockOnly: true` flag drives the yellow "mock" badge.
- Tests: [`core/api/src/tiktok/realClient.test.ts`](../../core/api/src/tiktok/realClient.test.ts) (7 cases — token exchange, refresh, getMyUser, expiry parsing).

## Limitations & gotchas

- **PKCE is mandatory.** TikTok rejects authorize requests without `code_challenge`. If the cookie is missing at callback time the route returns 400 — the user has to re-click "Add TikTok".
- **Content Posting API has a separate app-review gate.** Even with Login Kit approved, `video.upload` and `video.publish` need their own submission. Plan on 1–2 weeks if you need production uploads.
- **App icon + HTTPS Terms/Privacy URL are required** for the dev-portal save to succeed. The form rejects `http://localhost:…` URLs (TikTok requires HTTPS). Use GitHub Pages, ngrok, or your own domain.
- **No multi-account per TikTok user.** Re-connecting updates the same `open_id` row. A user managing multiple TikTok accounts (business + personal) must pick one.
- **Refresh token has 365-day expiry** (TikTok-side policy, not enforced by code). After one year the user must re-connect. The worker surfaces this as `status='revoked'` once `refreshLongLivedToken()` fails.
- **`open_id` is the durable key**, not the username. Display name is fetched once at connect time and updated only on reconnect (no periodic sync).
- **The legacy mock flow** (`/auth/instagram/start`, `/auth/facebook/start` mounted only when `USE_MOCK_PUBLISHERS=true`) does NOT cover TikTok. TikTok mocking happens through the real OAuth factory only.

## Related pages

- [Architecture](../architecture.md) — system-level diagram and module map.
- [ADR-0002: Mock client pattern](../decisions/0002-mock-google-client-pattern.md) — factory pattern rationale (same for TikTok).
- [ADR-0003: AES-256-GCM token encryption](../decisions/0003-aes-256-gcm-token-encryption.md) — token storage rationale.
- [Phase 2 plan](../../plans/core/phase-2-multi-platform/plan.md) — multi-platform publisher abstraction context.
