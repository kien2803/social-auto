# Session Notes — Resume Point (2026-10-26)

## Trạng thái code

- `master` đã push lên GitHub `kien2803/social-auto` — 3 commits: hardening + full-stack + mock gating.
- Working tree sạch (chỉ 2 file untracked dead code: `core/api/src/meta/authRoutes.ts`, `core/api/src/tiktok/authRoutes.ts` — không được import, nên xóa).
- Tests: API 156 + worker 67 + web 24 — all green lần verify cuối.
- `.env.local` đang chứa **Google OAuth credentials THẬT** (client `tsq32i9e4g…`, project `socia-auto`). File này đã gitignore — tuyệt đối không commit.

## Cấu hình OAuth hiện tại (.env.local)

```
USE_MOCK_GOOGLE=false      # YouTube OAuth thật
USE_MOCK_PUBLISHERS=false  # worker publish thật (mọi platform!)
USE_MOCK_TIKTOK=true       # vẫn mock
USE_MOCK_META=true         # vẫn mock
WEB_ORIGIN=http://localhost:3000   # PHẢI khớp redirect_uri đã đăng ký trên Google Console
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

⚠️ `WEB_ORIGIN` là ground truth cho OAuth redirect_uri (xem `auth.ts` `/auth/youtube/start`).
Chạy vite dev (:5173) thì OAuth callback vẫn về :3000 — OK, nhưng post-callback redirect đi `WEB_ORIGIN`.
Nếu muốn dev qua :5173 hoàn toàn → phải add `http://localhost:5173/auth/callback` vào Google Console.

## Google Console state

- Project `socia-auto`, app **In production** nhưng **chưa verify** → consent screen hiện "unverified app" → chọn Advanced → Go to social-auto.
- Scope `youtube.upload` chưa verify → **video upload lên sẽ bị khóa private** (policy Google).
- Client ID `…tsq32i9e4g…` với redirect `http://localhost:3000/auth/callback`.
- File `~/Downloads/client_secret_*.json` chứa 2 client gộp nhau — đang dùng cái thứ 2.

## Chạy lại stack (dev)

```bash
# API + embedded worker (sql.js chỉ cho 1 writer — KHÔNG chạy worker tách!)
cd core/api && WEB_DIST_DIR=../web/dist EMBEDDED_WORKER=true pnpm dev   # :3000
# Web dev (optional — hoặc dùng luôn dist trên :3000)
cd core/web && VITE_API_TARGET=http://localhost:3000 pnpm dev          # :5173
```

Test account: `demo@socialauto.dev` / `demo123456`.

## Việc đang dở — test Connect YouTube thật

Đang test OAuth connect qua browser bằng computer-use (Zen preview pid 24472).
**Bị chặn**: AT-SPI `set-value` set DOM value nhưng không trigger React state → form submit báo "missing fields". Synthetic keyboard cần OS-level focus mà Wayland không cho tool tự grant.

→ **Ngày mai**: để user tự click focus + login rồi Connect YouTube (Google consent bắt buộc phải click tay), hoặc bỏ qua computer-use — flow này vốn dĩ cần thao tác người. Verify sau connect: `GET /auth/youtube/status` trả account thật, upload video → schedule → worker post lên YouTube (sẽ là private).

## Cập nhật 2026-10-26 (sau)

- `00f4b19` đã push: SECURE_COOKIES + /privacy page + .env.production.example + Caddyfile + Dockerfile fix (libxcb)
- **Docker build ĐÃ VERIFY qua podman** (`podman build -t social-auto .`) — container chạy OK: health + SPA + API. Lưu ý: podman port-forward dùng `127.0.0.1` (localhost resolve ::1 fail)
- OAuth state mismatch root cause: cookie domain `127.0.0.1` ≠ `localhost` — phải dùng `http://localhost:3000` (gõ đúng chữ localhost)

## Việc còn lại (ưu tiên)

1. **User tự test Connect YouTube** qua `http://localhost:3000` — consent phải click tay
2. OAuth review: TikTok + Meta + Google verification — cần deploy public trước
3. Deploy VPS/Railway: docker-compose sẵn, Caddyfile auto-HTTPS, chỉ cần domain + DNS
4. Code gaps: UI change-password/delete-account (API sẵn), video stream route, cancel upload
5. Scale-up khi cần: Postgres, S3, refresh token, per-user quota

## Cloudflare migration — foundation done (P0–P1, một phần P2/P6)

Package `core/cloudflare` đã scaffold + chạy được trên `workerd`:
- `wrangler.toml`: D1 `DB`, R2 `STORAGE`, Queue `PUBLISH_QUEUE` + DLQ, cron `*/1 * * * *`
- `migrations/0001_init.sql` — schema gộp (end-state của 11 migrations cũ)
- `src/index.ts` — fetch (Hono) + `scheduled` (claim due→enqueue) + `queue` consumer skeleton
- Routes xong: `/health`, `POST /auth/register`, `POST /auth/login` — cùng API contract `{token,user}` với Fastify
- `lib/crypto.ts` WebCrypto AES-GCM wire-compatible với Node (`iv:tag:ct` hex), `lib/jwt.ts` jose HS256 7d
- `repos/users.ts` — pattern async D1 cho các repo còn lại

### Verify local
```bash
cd core/cloudflare && pnpm install && pnpm dev --local   # :8787
pnpm exec wrangler d1 migrations apply social-auto-db --local
```
Secrets local ở `core/cloudflare/.dev.vars` (gitignored). Đã test: register 201, login 200 JWT, wrong-pass 401.

### Gotchas đã gặp
- bcryptjs@3 cần `setRandomFallback` + lazy hash (module-scope crypto không có trong workerd)
- wrangler 3.x local — compat date bị fallback 2025-07-18; upgrade wrangler 4 khi deploy thật
- Miniflare không auto-fire cron — test scheduled bằng `--test-scheduled` hoặc `/__scheduled`

### Còn lại theo plan (P2–P8)
- P2: port accounts/videos/scheduledPosts/quotas repos → async D1 (~100 queries)
- P3: port ~15 route files sang Hono (accounts, videos, schedule, auth OAuth callbacks, quota, health, userAuth mgmt)
- P4: R2 multipart upload + client-side probe/thumbnail (bỏ ffmpeg)
- P5: queue consumer → port publishers (youtube/tiktok/meta) + mark dead từ DLQ
- P7: Pages deploy + route /api → Worker
- P8: OAuth redirect URIs đổi sang domain CF + secrets qua `wrangler secret put`

## 2026-10-26 — DỪNG migration 100% Cloudflare

User quyết định dừng hướng Cloudflare. `core/cloudflare/` giữ nguyên trên repo
như scaffold tham khảo (không ảnh hưởng app chính) — nếu muốn xóa hẳn:
`git rm -r core/cloudflare` + revert workspace entry trong pnpm-workspace.yaml.

**Track chính vẫn là Fastify app hiện tại** — deploy path = Docker (đã verify
qua podman) + VPS/Railway + Caddy. CF dev worker :8787 đã tắt.
