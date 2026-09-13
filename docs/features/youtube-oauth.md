---
title: YouTube OAuth (Phase 0)
description: >-
  Connect a YouTube account to social-auto via Google OAuth 2.0, persist the refresh
  token encrypted at rest, and verify the connection by reading the channel name back
  from Google. The minimum-viable credential flow that unblocks Phase 1 (upload).
---

# YouTube OAuth

The first end-to-end feature shipped. Lets a user click **Connect YouTube** in the web UI, authorize the app against their Google account, and have social-auto remember them across server restarts. No video upload happens yet — that's Phase 1.

## Key features

- **One-click connect** — a single button on `/accounts` runs the full OAuth dance.
- **Encrypted token storage** — refresh and access tokens are stored AES-256-GCM encrypted; only the API process with `TOKEN_ENCRYPTION_KEY` can read them.
- **Status check** — `/auth/youtube/status` decrypts the access token and calls Google's `channels.list?mine=true` to verify the token still works. If revoked, the user sees 401 and can re-connect.
- **Persists across restarts** — SQLite file on disk; closing the server and reopening keeps the connection.
- **Test-friendly** — a mock Google client implements the same interface; tests run with `USE_MOCK_GOOGLE=true` and never touch the network.

## How it works

The flow has three endpoints, all in `apps/api/src/routes/auth.ts`. The web app initiates; Google mediates; the API persists and verifies.

### 1. Start

`GET /auth/youtube/start` — the API generates a 16-byte hex `state`, sets it in a short-lived `oauth_state` cookie (httpOnly, sameSite=lax, path `/auth`, maxAge 600s), and 302-redirects the browser to Google with the state in the query string.

Google's authorization URL is built by the configured `GoogleOAuthClient.buildAuthUrl(state)` — the mock client builds a real-looking Google URL (so tests can assert on it); the real client calls `oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['youtube.upload'] })`.

### 2. Callback

`GET /auth/callback?code=...&state=...` — Google redirects back. The API:

1. Compares `state` from the query against the `oauth_state` cookie. Mismatch → **400 state mismatch**.
2. Calls `google.exchangeCode(code)` → `{ access_token, refresh_token, expires_at, scope, token_type }`.
3. If no `refresh_token` returned → **400**. (Google only returns it when `prompt=consent` and the user hasn't authorized this app before. The route forces `prompt: 'consent'`.)
4. Calls `google.getMyChannel(access_token)` to get the channel `{ id, title, thumbnail_url }`.
5. Encrypts `refresh_token` and `access_token` with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM, format `iv:tag:ciphertext`).
6. Upserts the `accounts` table: if a row with `platform='youtube'` already exists, update tokens; otherwise insert with `status='active'`.
7. Redirects the browser to `${WEB_ORIGIN}/accounts?connected=youtube`.

### 3. Status

`GET /auth/youtube/status` — the API reads the YouTube account row, decrypts the access token, and calls `getMyChannel(access_token)` to verify the token still works.

| Condition | Response |
|---|---|
| No account row | `200 { connected: false }` |
| Row exists, `status != 'active'` | `401 { connected: false, status }` |
| Decryption fails (wrong key, corrupt payload) | `401 { connected: false, error: 'decryption_failed' }` |
| Access token missing | `401 { connected: false, error: 'no_access_token' }` |
| Google rejects the token | `401 { connected: false, error: 'token_rejected' }` |
| All good | `200 { connected: true, account: { id, platform, display_name, status } }` |

The web UI uses only the boolean `connected` and the `account.display_name`.

## Configuration

Required environment variables (see [`.env.example`](../../.env.example)):

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from Google Cloud Console → APIs & Services → Credentials.
- `GOOGLE_REDIRECT_URI` — must match an **Authorized redirect URI** in the OAuth client. Default `http://localhost:3000/auth/callback`.
- `TOKEN_ENCRYPTION_KEY` — 64 hex chars (32 bytes). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `DATABASE_URL` — defaults to `file:./storage/app.db`.
- `WEB_ORIGIN` — defaults to `http://localhost:5173`. Used for the post-callback redirect.
- `USE_MOCK_GOOGLE` — `true` to use the mock client (no Google credentials needed). Defaults to `false`.

### One-time Google Cloud setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable **YouTube Data API v3**.
3. **OAuth consent screen**: User type = External, add scope `https://www.googleapis.com/auth/youtube.upload` (non-sensitive).
4. Add your email as a **Test user** (the app is unpublished; only test users can authorize).
5. **Credentials** → Create OAuth 2.0 Client ID, type **Web application**.
6. Add `http://localhost:3000/auth/callback` to **Authorized redirect URIs**.
7. Copy Client ID and Client Secret into `.env.local`.

## Local walkthrough

1. `pnpm install`
2. `cp .env.example .env.local`, fill in the variables above.
3. `pnpm dev` (runs API + Web in parallel).
4. Open <http://localhost:5173/accounts>.
5. Click **Connect YouTube** → authorize on Google → land back on `/accounts` showing `Connected as: <your channel title>`.
6. Restart `pnpm dev` and reload — still connected.

## Implementation pointers

- Route handlers: [`apps/api/src/routes/auth.ts`](../../apps/api/src/routes/auth.ts)
- Google client interface: [`apps/api/src/google/client.ts`](../../apps/api/src/google/client.ts)
- Real client (uses `googleapis`): [`apps/api/src/google/realClient.ts`](../../apps/api/src/google/realClient.ts)
- Mock client: [`apps/api/src/google/mockClient.ts`](../../apps/api/src/google/mockClient.ts)
- Factory that picks real vs mock: [`apps/api/src/google/factory.ts`](../../apps/api/src/google/factory.ts)
- Accounts repository: [`apps/api/src/repositories/accounts.ts`](../../apps/api/src/repositories/accounts.ts)
- Token encryption: [`packages/shared/src/utils/crypto.ts`](../../packages/shared/src/utils/crypto.ts)
- Web UI: [`apps/web/src/pages/AccountsPage.tsx`](../../apps/web/src/pages/AccountsPage.tsx)
- Tests: [`apps/api/src/routes/auth.test.ts`](../../apps/api/src/routes/auth.test.ts) (7 cases — happy path, state mismatch, persistence across restart, token rejected, etc.)

## Limitations & gotchas

- **One YouTube account per install.** Re-connecting updates the stored tokens but you cannot manage multiple YouTube channels. See [ADR-0005](./../decisions/0005-single-account-per-platform-phase-0.md).
- **Refresh token is the long-lived secret.** If a user revokes access in their Google account settings, the next `/status` call returns 401 `token_rejected`. They must re-connect.
- **Plain (unsigned) state cookie.** Phase 0 doesn't sign the `oauth_state` cookie — relying on httpOnly + sameSite=lax + short maxAge. A signed cookie (e.g. `@fastify/cookie` with a `signed` option) is a future hardening.
- **`prompt=consent` is forced.** This is intentional — Google only returns a `refresh_token` on first consent. Without it, returning users would silently lose the ability to refresh.
- **Webhook for token revocation not implemented.** If a user revokes from Google's side, social-auto won't notice until the next `/status` call (or upload attempt in Phase 1). Google's [PubSubHubbub push notifications](https://developers.google.com/youtube/v3/guides/push_notifications) are the proper solution for Phase 3+.

## Related pages

- [Architecture](../architecture.md) — system-level diagram and module map.
- [ADR-0002: Mock Google client pattern](../decisions/0002-mock-google-client-pattern.md) — why we have a mock client.
- [ADR-0003: AES-256-GCM token encryption](../decisions/0003-aes-256-gcm-token-encryption.md) — token storage rationale.
- [ADR-0005: Single-account-per-platform Phase 0](../decisions/0005-single-account-per-platform-phase-0.md) — the one-account constraint.
