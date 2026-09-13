# Google Cloud Setup — YouTube Data API v3

Phase 0 cần Google Cloud project + OAuth credentials để `GET /auth/youtube/status` chạy thật. Tests và dev mode dùng mock (xem `USE_MOCK_GOOGLE=true`).

> **TL;DR**: hai chế độ chạy
>
> | Mode | `USE_MOCK_GOOGLE` | Cần Google creds? | Dùng cho |
> |---|---|---|---|
> | Mock | `true` | không | fresh checkout, simulator, CI, dev khi chưa có Google Cloud project |
> | Real | `false` | có | publish thật lên YouTube channel của bạn |
>
> Khi set `false` mà `GOOGLE_CLIENT_ID` trống, API sẽ crash với message hướng dẫn quay lại file này.

## Bước 1 — Tạo project

1. Mở https://console.cloud.google.com/
2. Top bar → project dropdown → **New Project**.
3. Tên: `social-auto` (hoặc tùy ý).
4. Create.

## Bước 2 — Enable YouTube Data API v3

1. Menu → **APIs & Services** → **Library**.
2. Search "YouTube Data API v3".
3. Click → **Enable**.

## Bước 3 — OAuth consent screen

1. **APIs & Services** → **OAuth consent screen**.
2. User type: **External** (cho cá nhân / non-Google-Workspace).
3. App info:
   - App name: `social-auto` (hiện cho user khi authorize).
   - User support email: email của bạn.
   - Developer contact: email của bạn.
4. **Scopes**: add cả hai scope sau (cả hai đều bắt buộc):
   - `https://www.googleapis.com/auth/youtube.upload` — để worker publish video
   - `https://www.googleapis.com/auth/youtube.readonly` — để API gọi `channels.list?mine=true` lấy thông tin channel khi user authorize / sync. **Nếu thiếu scope này, `getMyChannel` sẽ trả 403 và `/auth/youtube/status` báo expired.**
5. **Test users**: add email Google của bạn (bắt buộc khi app ở trạng thái "Testing").
6. Save.

## Bước 4 — Tạo OAuth Client ID

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Application type: **Web application**.
3. Name: `social-auto-local`.
4. **Authorized redirect URIs**: thêm `http://localhost:3000/auth/callback`.
   - Phải khớp **chính xác** với `GOOGLE_REDIRECT_URI` trong `.env.local` (cả scheme, host, port, path).
   - Mỗi port khác nhau (3001, 4000, …) cần entry riêng.
5. Create.
6. Copy **Client ID** + **Client Secret**.

## Bước 5 — Điền vào .env.local

```bash
cp .env.example .env.local
```

Sửa `.env.local`:

```env
# Bật real OAuth
USE_MOCK_GOOGLE=false
USE_MOCK_PUBLISHERS=false

GOOGLE_CLIENT_ID=<paste Client ID>
GOOGLE_CLIENT_SECRET=<paste Client Secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# Generate 32-byte hex key:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=<paste 64-char hex>
```

> Nếu muốn quay lại mock mode (không cần Google creds), chỉ cần set `USE_MOCK_GOOGLE=true`. Hai biến `GOOGLE_CLIENT_*` khi đó có thể để trống — API sẽ dùng stub.

## Bước 6 — Smoke test thật

```bash
pnpm dev
```

Mở http://localhost:5173/accounts → click "Connect YouTube" → authorize → redirect về app → status "Connected as: <channel title>".

## Multi-account (Phase 2)

OAuth client **đa dụng cho mọi YouTube channel**: cùng một Client ID authorize được nhiều channel khác nhau (mỗi user/email Google riêng). `social-auto` lưu mỗi channel thành một row riêng trong bảng `accounts`, key theo `(platform, external_id)`. Nếu cùng channel reconnect → refresh token rotated; nếu channel mới → row mới.

Không cần tạo OAuth client mới cho mỗi channel.

## Quota

YouTube Data API v3 mặc định **10,000 units/day**. Resumable upload tốn ~1,600 units. → ~6 uploads/day cho 1 dev project.

`channels.list` (mỗi lần `/auth/youtube/status` hoặc `/accounts/:id/sync`) tốn 1 unit. Không đáng kể.

Nếu cần nhiều hơn, xin extension tại **APIs & Services** → **YouTube Data API v3** → **Quotas**.

## Lưu ý

- **Refresh token chỉ trả về lần đầu** authorize. Nếu bạn re-authorize mà không có `prompt=consent`, Google sẽ KHÔNG trả refresh token mới → app sẽ báo lỗi. Mitigation: revoke access tại https://myaccount.google.com/permissions rồi connect lại. Code path real OAuth đã set `prompt=consent` ở `core/api/src/google/realClient.ts:51-54` để tránh vấn đề này.
- **App ở trạng thái "Testing"** chỉ cho phép test users đã add. Không public được cho người khác dùng — chấp nhận được cho personal use.
- **Rotate `TOKEN_ENCRYPTION_KEY`** sẽ làm invalid tất cả encrypted tokens đã lưu. Khi đó mọi account cần reconnect. Code có sẵn `updateTokens` flow, nhưng chưa có tool migrate — đơn giản nhất là xóa `accounts` rows và reconnect.
- Nếu cần publish app ra ngoài (multi-user), cần Google verification → không cần cho mục đích cá nhân.
- **Prod redirect URI**: nếu deploy API lên host khác (không phải localhost:3000), thêm URI đó vào Authorized redirect URIs trong Google Cloud Console trước khi set `GOOGLE_REDIRECT_URI` trong env.
