---
title: Meta OAuth (Facebook + Instagram, Phase 2)
description: >-
  Connect a Facebook Page + linked Instagram Business account in one round-trip.
  One OAuth (Facebook Login with `pages_show_list, pages_manage_posts,
  instagram_basic, instagram_content_publish` scopes) yields a durable
  long-lived user token; the API calls `/me/accounts` to enumerate the user's
  Pages + linked IG business accounts, then upserts one row per Page + IG pair.
---

# Meta OAuth (Facebook + Instagram)

The third end-to-end OAuth flow shipped (Phase 2). The hook is: a single Facebook Login round-trip authorizes access to **both** Facebook Pages AND any linked Instagram Business accounts associated with those Pages. One callback → 1 row per (platform, page_id / ig_business_id) tuple. The worker treats each row's `oauth_access_token` (the long-lived user token, mirrored as the page access token) as the publish credential.

## Key features

- **One-click, multi-row connect** — single Facebook Login → emits N account rows: 1 per `Page` the user owns + 1 per `Instagram Business` linked to a Page. A user with 2 Pages + 1 IG ends with 3 account rows.
- **Long-lived user token** — exchanges the short-lived (~2h) callback token for a 60-day long-lived token via `oauth/access_token?grant_type=fb_exchange_token`. Worker uses this as both the access and refresh token (Meta's "refresh" is the same endpoint with the long-lived token as input).
- **Encrypted token storage** — 60-day tokens are stored AES-256-GCM encrypted; only the API process with `TOKEN_ENCRYPTION_KEY` can read them.
- **Mock fallback** — `USE_MOCK_META=true` (or any of `META_APP_ID` / `META_APP_SECRET` / `META_REDIRECT_URI` empty) returns the mock client. The mock substitutes a hard-coded page + linked IG.
- **Persists across restarts** — SQLite file on disk; closing the server and reopening keeps the connection.
- **Popup-mode aware** — same flow as YouTube/TikTok: `?popup=1` sets `oauth_popup` cookie; callback lands on `/auth/popup-close` (postMessage with parent SPA).

## How it works

The flow has three endpoints, all in `core/api/src/meta/authRoutes.ts`. The web app initiates; Facebook mediates; the API persists.

### 1. Start

`GET /auth/meta/start` — the API:

1. Generates a 16-byte hex `state`, stashes it in an httpOnly `oauth_state` cookie.
2. If `?popup=1` is present, sets the `oauth_popup` cookie.
3. 302-redirects the browser to `https://www.facebook.com/<API_VERSION>/dialog/oauth?client_id=<META_APP_ID>&redirect_uri=<META_REDIRECT_URI>&state=…&scope=public_profile,email,pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish&response_type=code`.

The mock client's `buildAuthUrl()` redirects straight to `/auth/meta/callback?state=…&code=mock-meta-code-N` so the test path doesn't touch Facebook.

### 2. Callback

`GET /auth/meta/callback?code=…&state=…` — Facebook redirects back. The API:

1. Compares `state` from query against the `oauth_state` cookie. Mismatch → **400 state mismatch**.
2. Calls `meta.exchangeCode(code)` → `{ access_token, long_lived_token, expires_at }`. Real client also chains `exchangeForLongLivedToken(short)` to get the 60-day token.
3. Calls `meta.listMyPages(durable)` → `Array<{ id, name, access_token, picture_url, instagram_business_account_id?, instagram_username? }>`.
4. Builds one row per Page + one per linked IG Business account.
5. Encrypts `oauth_refresh_token` (mirrored from the durable long-lived token) + `oauth_access_token` with `TOKEN_ENCRYPTION_KEY`.
6. Upserts each into `accounts`:
   - For Page: `platform='facebook'`, `external_id=p.id`, `display_name=p.name`.
   - For IG: `platform='instagram'`, `external_id=p.instagram_business_account_id`, `display_name=@${username}` or id.
7. For new rows the per-row `avatar_url` is set from `p.picture_url` or `p.instagram_business_account.profile_picture_url` (looked up by exact id then by `instagram_business_account_id` as fallback).
8. Reconnect updates `display_name` + `oauth_access_token` + clears avatar.
9. Redirects the browser to `${WEB_ORIGIN}/accounts?connected=meta&accounts=<id1,id2,...>`.

### 3. Worker publish

Worker dispatches by `account.platform`:

- Facebook Reels: `POST /<page-id>/videos` with page access token.
- Instagram Reels: `POST /me/media` (create container) → `POST /me/media_publish` (publish).

Page access token = user durable token (mirror in `accounts.oauth_access_token`). No separate page-token request needed since `pages_show_list` returns the page-token in `/me/accounts`.

If the user revokes the app in their Facebook settings, the next publish returns 400/401 with `error_subcode=190` (token revoked). Worker catches via `isRevoked()` and marks `status='revoked'` — same path as YouTube.

## Configuration

Required environment variables:

- `META_APP_ID` — App ID from [developers.facebook.com](https://developers.facebook.com) → your app → Settings → Basic.
- `META_APP_SECRET` — click **Show** next to "App Secret" on the same page.
- `META_REDIRECT_URI` — must match a **Valid OAuth Redirect URI** in Facebook Login → Settings. Default for dev: `http://localhost:5182/auth/meta/callback`.
- `META_API_VERSION` — defaults to `v24.0`.
- `TOKEN_ENCRYPTION_KEY` — 64 hex chars (32 bytes).
- `USE_MOCK_META` — defaults to `true` so a fresh checkout boots without Meta creds. Flip to `false` for real OAuth + publishing.

### One-time Meta app setup

1. Create an app at [developers.facebook.com/apps](https://developers.facebook.com/apps) → type **Business**.
2. **Add products** → **Facebook Login** (auto-enabled).
3. **Facebook Login → Settings**: add `http://localhost:5182/auth/meta/callback` to **Valid OAuth Redirect URIs**. Save.
4. **App Review → Permissions and Features**: request review for:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
5. **Roles → Testers**: add your own Facebook account so you can test before production review.
6. **Settings → Basic** → switch from **In Development** to **Live** (one-click if you've accepted the Platform Terms).
7. **Facebook Pages**: you must be Admin/Editor of at least 1 Page. To publish Reels on the linked Instagram: link an **Instagram Business** or **Creator** account to the Page (Page Settings → Instagram → Connect).

**Personal IG accounts (not Business/Creator) cannot be used** — Meta's Graph API rejects them.

### Auto-fallback behavior

`createMetaClient()` (in `core/api/src/meta/factory.ts`):

```ts
const useMock =
  config.forceMock === true ||
  process.env['USE_MOCK_META'] === 'true' ||
  !config.appId || !config.appSecret || !config.redirectUri;
```

If you leave any of those env vars empty → factory silently returns the mock. The mount in `core/api/src/server.ts` then:

```ts
const metaUseMock = !env.metaAppId || !env.metaAppSecret || !env.metaRedirectUri;
registerAuthRoutes(app, { ..., useMockPublishers: env.useMockPublishers || metaUseMock });
```

— when Meta creds are empty, the legacy `/auth/instagram/start` + `/auth/facebook/start` mock routes mount (1 click → `mock-ig-…` / `mock-fb-…` token prefix). The new `/auth/meta/start` does **not** mount unless creds exist (mock client wouldn't have a valid `client_id` to send to Facebook anyway).

## Local walkthrough

### Mock (no setup)

1. `pnpm install`
2. Leave `USE_MOCK_META=true` in `.env.local` (default).
3. `pnpm core:dev`
4. Open <http://localhost:5181/accounts>
5. Click **Add Instagram account** → 1 row appears with `mock-ig-…` token.
6. Click **Add Facebook account** → 1 row with `mock-fb-…`.
7. Worker stub publishers accept the `mock-ig-/mock-fb-` prefix for upload simulation.

### Real (after Meta app setup)

1. Fill `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` in `.env.local`. Set `USE_MOCK_META=false`.
2. `pnpm core:dev`
3. Click **Add Instagram account** — UI shows the IG/FB together under "Add Meta account" in the implementation. (The ConnectMenu shows IG and FB as separate buttons; both go through `/auth/meta/start` since the API only has one combined route — both rows appear after a single OAuth round-trip.)
4. Facebook consent screen → pick Page + linked IG → land back on `/accounts` with 2 new rows (1 Page + 1 IG if linked).

### Caveat: UI label vs reality

The `ConnectMenu` in the web UI renders 4 buttons (YouTube, TikTok, IG, FB) but the **API only has 3 OAuth routes** (YouTube, TikTok, Meta). Clicking "Add Instagram" or "Add Facebook" both go to `/auth/meta/start`. After consent, both rows appear together. If the user has no Pages or no linked IG, only the rows that exist are inserted.

## Implementation pointers

- Real route handlers: [`core/api/src/meta/authRoutes.ts`](../../core/api/src/meta/authRoutes.ts)
- Real client (Graph API v24.0): [`core/api/src/meta/realClient.ts`](../../core/api/src/meta/realClient.ts)
- Mock client: [`core/api/src/meta/mockClient.ts`](../../core/api/src/meta/mockClient.ts)
- Factory: [`core/api/src/meta/factory.ts`](../../core/api/src/meta/factory.ts)
- Worker publisher for FB: [`core/worker/src/publishers/facebook.ts`](../../core/worker/src/publishers/facebook.ts)
- Worker publisher for IG: [`core/worker/src/publishers/instagram.ts`](../../core/worker/src/publishers/instagram.ts)
- Worker Meta tests: [`core/worker/src/publishers/meta.test.ts`](../../core/worker/src/publishers/meta.test.ts) (8 cases — page token use, IG container flow, validation rules)
- Real-client tests: [`core/api/src/meta/realClient.test.ts`](../../core/api/src/meta/realClient.test.ts) (7 cases — fetch mocked)
- Web UI ConnectMenu: [`core/web/src/pages/AccountsPage.tsx`](../../core/web/src/pages/AccountsPage.tsx)

## Limitations & gotchas

- **No Pages → no rows.** A user without Facebook Pages (only a personal profile) connects to nothing useful. The callback returns 0 inserted rows.
- **Reels only.** Phase 2 plan implements Reels (videos), not Stories, not Feed photos, not Carousel. Adding an image post would need new container endpoints (`/me/media` type `IMAGE`).
- **App-review is the bottleneck.** Production-mode publishing requires `instagram_content_publish` and `pages_manage_posts` to be **Live** (not Pending). Plan on 1–2 weeks.
- **Linking IG requires being Page admin.** If `instagram_business_account_id` is null on the Page response, the IG account isn't linked or the user has insufficient role.
- **Long-lived token = 60 days.** Worker refreshes via `refreshLongLivedToken()` which extends another 60 days. After multiple refresh failures the worker marks `status='expired'`.
- **No Page selection UI.** First iteration: connect runs `/me/accounts` and inserts every Page + every linked IG. A user with 10 Pages gets 10 rows. Future UX: pick which Pages + IG to connect.
- **Meta accounts are NOT multi-account per user.** Each `page_id` is unique; reconnecting with the same Page overwrites the row. Different Pages → multiple rows.

## Related pages

- [Architecture](../architecture.md)
- [ADR-0002: Mock client pattern](../decisions/0002-mock-google-client-pattern.md)
- [ADR-0003: AES-256-GCM token encryption](../decisions/0003-aes-256-gcm-token-encryption.md)
- [Phase 2 plan](../../plans/core/phase-2-multi-platform/plan.md)
- [Phase 2 fix-bugs log](../../plans/core/phase-2-multi-platform/fix-bugs.md) — historical Meta OAuth bugs (BUG-P2-001 mock token prefix issue, etc.)
