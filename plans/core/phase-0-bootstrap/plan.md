# Phase 0 — Bootstrap & Credentials

**Goal**: Repo scaffold chạy được local, có Google Cloud project + YouTube OAuth refresh token để dùng cho Phase 1.

**Status**: done (2026-08-28)
**Estimate**: M (1-2 days)
**Depends on**: —

## Tasks

- [ ] **T0.1** Repo init
  - Monorepo layout: `apps/web` (Vite + React + TS + Tailwind), `apps/api` (Fastify + TS), `apps/worker` (Node script), `packages/shared` (types + DB schema).
  - Tooling: pnpm workspaces, ESLint, Prettier, TypeScript strict.
  - `.env.example` liệt kê keys cần có.
  - `.gitignore`: `.env.local`, `storage/`, `node_modules/`, `dist/`.

- [ ] **T0.2** Google Cloud setup
  - Tạo project tại console.cloud.google.com.
  - Enable **YouTube Data API v3**.
  - OAuth consent screen: User type = External, scopes = `https://www.googleapis.com/auth/youtube.upload` (non-sensitive).
  - Tạo OAuth 2.0 Client ID (type: **Web application** vì flow có redirect).
  - Authorized redirect URI: `http://localhost:3000/auth/callback`.
  - Lưu Client ID + Client Secret vào `.env.local`.

- [ ] **T0.3** OAuth local flow
  - Route `GET /auth/youtube/start` → generate auth URL, redirect user.
  - Route `GET /auth/callback` → exchange code for tokens, lưu `refresh_token` vào DB.
  - Route `GET /auth/youtube/status` → check refresh token còn valid (gọi `channels.list?part=snippet&mine=true`).
  - Verify: trang web hiện "Connected as: <channel title>".

## Shared contracts introduced

```ts
// packages/shared/src/db/schema.ts
Account {
  id: string (uuid)
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook'
  display_name: string
  oauth_refresh_token: string (encrypted)
  oauth_access_token: string (encrypted, optional cache)
  token_expires_at: timestamp
  status: 'active' | 'expired' | 'revoked'
  created_at: timestamp
}
```

## Out of scope
- Upload video.
- Schedule posts.
- Multi-account.
- Retry logic.

## Risks
- Google OAuth consent screen cần verified status nếu publish ra ngoài — cho cá nhân không cần, chỉ cần test users list (thêm email của bạn).
- Refresh token chỉ được trả về **lần đầu** authorize — nếu mất phải revoke + re-authorize.

## Acceptance check
- [ ] `pnpm dev` mở được `http://localhost:5173`.
- [ ] Trang `/accounts` hiện nút "Connect YouTube".
- [ ] Click → OAuth flow → redirect về app → hiện "Connected as: <tên channel>".
- [ ] `accounts` table có 1 row với `refresh_token` non-null.
- [ ] Restart server → vẫn "Connected" (refresh token persist).