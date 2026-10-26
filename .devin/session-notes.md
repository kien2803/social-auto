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

## Việc còn lại (ưu tiên)

1. **User tự test Connect YouTube** — consent phải click tay
2. Xóa 2 file dead untracked (meta/tiktok authRoutes)
3. OAuth review: TikTok partner review + Meta app review + Google verification (critical path)
4. Docker verify trên máy có daemon
5. Code gaps: UI change-password/delete-account (API sẵn), video stream route, cancel upload
6. Scale-up khi cần: Postgres, S3, refresh token, per-user quota
