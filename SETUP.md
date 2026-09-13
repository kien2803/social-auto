# Setup Google Cloud Console for YouTube

Required to switch from mock mode to real YouTube uploads.

## 1. Create a project

1. https://console.cloud.google.com/
2. Top dropdown → **New Project** → name it `social-auto` → **Create**

## 2. Enable YouTube Data API v3

**APIs & Services** → **Library** → search `YouTube Data API v3` → **Enable**

## 3. Configure OAuth consent screen

**APIs & Services** → **OAuth consent screen**

- User type: **External**
- App name: `Social Auto`
- User support email: your email
- Developer contact: your email
- **Scopes** → **Add or Remove** → tick `youtube.upload` (and `youtube.force-ssl` if you
  need to update video metadata after upload)
- **Test users** → add the Google account you want to connect from
- **Save and Continue**

## 4. Publish the app (critical)

> ⚠️ Skip this and refresh tokens expire every **7 days** regardless of usage.

1. **OAuth consent screen** → click **Publish App**
2. If Google asks for "verification" — for personal / single-user use, just
   stay in unverified mode. The unverified status warns the user but still
   allows the OAuth flow to complete.

## 5. Create OAuth client ID

**APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**

- Application type: **Web application**
- Name: `social-auto-web`
- **Authorized redirect URIs** → add:
  ```
  http://localhost:3000/auth/callback
  ```
- **Create** → copy the Client ID and Client Secret

## 6. Fill in `.env.local`

```bash
# core/.env.local
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
USE_MOCK_GOOGLE=false
USE_MOCK_PUBLISHERS=false
```

Restart with `pnpm core:dev`.

## How the token lifecycle works (server does this automatically)

1. You click **Connect YouTube** → popup opens `accounts.google.com`
2. You click **Allow** → Google redirects back to `/auth/callback?code=...`
3. The server (not the browser) exchanges the code for an `access_token` (1h)
   and a `refresh_token` (long-lived) using `client_secret`. The browser never
   sees the secret.
4. Tokens are encrypted with `TOKEN_ENCRYPTION_KEY` and stored in SQLite.
5. The worker refreshes the `access_token` automatically 60 s before expiry
   using the `refresh_token`. This happens silently — no popup, no user
   action.

## When you'll need to reconnect

The worker marks an account as `expired` and the post as `dead` if it
detects any of:

- User revoked the app at https://myaccount.google.com/permissions
- Google's `7-day Testing expiry` if the consent screen is still in
   **Testing** mode (always publish the app to avoid this)
- Refresh token is malformed or missing (only on first connect — never happens
  again once you have a valid token)
- The OAuth grant is unpublished by Google (rare, but documented)

Click **Connect YouTube** again on the Accounts page to reconnect — the old
expired row is replaced with a fresh one carrying a new `refresh_token`.

## Security notes (what the browser sees vs what the server does)

| Thing | Browser sees | Server does |
|-------|--------------|-------------|
| `client_secret` | never | stored in `.env.local`, used to exchange code |
| `access_token` | never (only API server uses it) | ephemeral, refreshed hourly |
| `refresh_token` | never | stored encrypted, used to mint new access tokens |
| Your Google password | directly on `accounts.google.com` only | never touches our code |
| Code in OAuth callback URL | briefly (browser address bar) | consumed within seconds, single-use |

The 5-step flow mirrors what browser extensions (VidIQ, TubeBuddy) and tools
like n8n do — the only differences for a local-only tool are:

- The "tool" lives on your machine, not in a cloud — so the
  `client_secret` and the encrypted tokens are on disk under your control.
- The popup is replaced by a same-tab redirect when `USE_MOCK_GOOGLE=true`.
