# Phase 0 — Tests

Mỗi test phải pass trước khi chuyển sang Phase 1.

## T0.1 — Repo init

| Test | Type | Expected |
|---|---|---|
| `pnpm install` chạy không lỗi | smoke | exit 0, `node_modules` tạo |
| `pnpm -F web dev` start Vite | smoke | log "Local: http://localhost:5173" |
| `pnpm -F api dev` start Fastify | smoke | log "Server listening on 3000" |
| `pnpm -F shared build` | smoke | `dist/` tạo, types emit |
| `pnpm typecheck` (root) | unit | 0 errors |
| `pnpm lint` (root) | unit | 0 errors |

## T0.2 — Google Cloud setup (manual)

| Test | Type | Expected |
|---|---|---|
| OAuth consent screen có scope `youtube.upload` | manual | Hiện trong consent screen preview |
| Test user email (của bạn) đã add | manual | Có thể authorize mà không bị "access denied" |
| Client ID + Secret được lưu `.env.local` | manual | File tồn tại, gitignored |

## T0.3 — OAuth flow

| Test | Type | Expected |
|---|---|---|
| `GET /auth/youtube/start` trả 302 với Google URL | unit (supertest) | status 302, location chứa `accounts.google.com/o/oauth2/v2/auth` |
| Auth URL có scope `youtube.upload` | unit | params.scope includes correct scope |
| `GET /auth/callback?code=...` lưu token vào DB | integration | row mới trong `accounts`, `refresh_token` non-null |
| `GET /auth/youtube/status` với token hợp lệ trả channel info | integration | status 200, body chứa `channelTitle` |
| `GET /auth/youtube/status` với token sai trả 401 | unit | status 401 |
| Refresh token persist qua server restart | manual | Stop + start server, vẫn "Connected" |

## Test tooling
- **Unit**: Vitest + supertest cho API.
- **Integration**: chạy thật với Google API (số lần tối thiểu để tránh quota).
- **E2E manual**: Playwright nếu cần click qua OAuth flow.