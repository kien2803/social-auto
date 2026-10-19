# API Credentials Setup Guide

Dự án social-auto đã có sẵn code tích hợp với YouTube, TikTok, Instagram và Facebook. Hiện tại đang chạy ở **mock mode** (giả lập). Để sử dụng thực tế, bạn cần lấy API credentials từ từng nền tảng.

## Trạng thái hiện tại

✅ **Đã có sẵn:**
- Code OAuth routes cho YouTube, TikTok, Meta (Facebook/Instagram)
- Mock clients (cho dev/test không cần credentials)
- Real clients (đã implement, chỉ cần credentials)
- Token encryption với AES-256-GCM
- Token refresh lifecycle

❌ **Cần thiết:**
- Google OAuth credentials (YouTube)
- TikTok OAuth credentials
- Meta OAuth credentials (Facebook/Instagram)

---

## 1. YouTube (Google OAuth)

### Tạo Google Cloud Project

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới: **Social Auto**
3. Chọn project → **APIs & Services** → **Library**
4. Tìm và enable: **YouTube Data API v3**

### Cấu hình OAuth Consent Screen

1. **APIs & Services** → **OAuth consent screen**
2. User type: **External**
3. App name: `Social Auto`
4. User support email: email của bạn
5. Developer contact: email của bạn
6. **Scopes** → **Add or Remove** → chọn:
   - `youtube.upload` (upload video)
   - `youtube.force-ssl` (cập nhật metadata - optional)
7. **Test users** → thêm Google account của bạn
8. **Save and Continue**
9. **Publish App** (quan trọng để refresh token không hết hạn sau 7 ngày)

### Tạo OAuth Client ID

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Name: `social-auto-web`
4. **Authorized redirect URIs** → thêm:
   ```
   http://localhost:3000/auth/callback
   ```
   (Nếu deploy production, thêm URL production)
5. **Create** → copy Client ID và Client Secret

### Cập nhật .env.local

```bash
USE_MOCK_GOOGLE=false
USE_MOCK_PUBLISHERS=false
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

---

## 2. TikTok

### Yêu cầu TikTok Partner Review

⚠️ **Quan trọng:** TikTok yêu cầu **partner review** trước khi sử dụng API upload video. Quy trình:

1. Đăng ký [TikTok for Developers](https://developers.tiktok.com/)
2. Tạo app: **Social Auto**
3. Yêu cầu permissions:
   - `video.upload` (upload video)
   - `video.publish` (publish video)
4. Submit để review
5. Sau khi approved, nhận `client_key` và `client_secret`

### Lấy Credentials

1. Truy cập [TikTok Developer Portal](https://developers.tiktok.com/)
2. Select app của bạn
3. **Apps** → **Manage Apps** → chọn app
4. **Keys & Permissions** → copy:
   - Client Key
   - Client Secret

### Cập nhật .env.local

```bash
USE_MOCK_TIKTOK=false
TIKTOK_CLIENT_KEY=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret
TIKTOK_REDIRECT_URI=http://localhost:3000/auth/tiktok/callback
```

---

## 3. Meta (Facebook + Instagram)

### Tạo Meta App

1. Truy cập [Meta for Developers](https://developers.facebook.com/)
2. **My Apps** → **Create App**
3. Select type: **Business** (hoặc appropriate type)
4. App name: `Social Auto`
5. Contact email: email của bạn
6. **Create App**

### Cấu hình Facebook Login

1. Trong app dashboard → **Add Product** → **Facebook Login**
2. **Settings** → **Valid OAuth Redirect URIs** → thêm:
   ```
   http://localhost:3000/auth/meta/callback
   ```
3. Enable permissions:
   - `pages_manage_posts` (đăng bài lên Facebook Pages)
   - `pages_read_engagement` (đọc thống kê)
   - `instagram_basic` (đọc thông tin Instagram)
   - `instagram_content_publish` (đăng bài Instagram)

### Cấu hình Instagram

1. **Products** → **Instagram** → **Add Product**
2. Chọn **Instagram Graph API**
3. Cấu hình Instagram Business Account

### Lấy Credentials

1. **Settings** → **Basic** → copy:
   - App ID
   - App Secret

### Cập nhật .env.local

```bash
USE_MOCK_META=false
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_REDIRECT_URI=http://localhost:3000/auth/meta/callback
META_API_VERSION=v24.0
```

---

## Kiểm tra kết nối

Sau khi thêm credentials:

1. Khởi động lại server:
```bash
cd core/api && pnpm dev
```

2. Truy cập: http://localhost:5173

3. Thử kết nối tài khoản:
   - Click "Connect YouTube" → sẽ redirect đến Google OAuth
   - Click "Connect TikTok" → sẽ redirect đến TikTok OAuth
   - Click "Connect Facebook/Instagram" → sẽ redirect đến Meta OAuth

4. Sau khi OAuth thành công, token sẽ được:
   - Encrypt với AES-256-GCM
   - Lưu trong SQLite database
   - Auto refresh khi sắp hết hạn

---

## Lưu ý quan trọng

### Security
- ❌ KHÔNG commit `.env.local` vào git
- ❌ KHÔNG chia sẻ credentials với người khác
- ✅ Giữ `TOKEN_ENCRYPTION_KEY` an toàn
- ✅ Rotate credentials nếu bị lộ

### Token Lifecycle
- **YouTube**: Refresh token gần như vô thời hạn (nếu app được published)
- **TikTok**: Refresh token có thời hạn, cần periodic re-authorization
- **Meta**: Long-lived token 60 ngày, cần refresh định kỳ

### Test trước khi Production
1. Test với 1 tài khoản trước
2. Upload video test (private/unlisted)
3. Kiểm tra token refresh hoạt động
4. Monitor logs để đảm bảo không có lỗi

---

## Troubleshooting

### Google OAuth Error: "redirect_uri_mismatch"
- Kiểm tra `GOOGLE_REDIRECT_URI` trong `.env.local` phải khớp chính xác với URI trong Google Cloud Console

### TikTok Error: "invalid_grant"
- Đảm bảo PKCE verifier được round-trip đúng
- Kiểm tra app đã được approved bởi TikTok

### Meta Error: "Invalid app ID"
- Đảm bảo App ID và App Secret đúng
- Kiểm tra app đang ở mode "Development" hoặc "Production"

---

## Mock Mode (cho dev)

Nếu chỉ muốn test UI không cần credentials:

```bash
USE_MOCK_GOOGLE=true
USE_MOCK_PUBLISHERS=true
USE_MOCK_TIKTOK=true
USE_MOCK_META=true
```

Mock mode sẽ:
- Return fake OAuth flows
- Không thực sự upload video
- Giả lập API responses
- An toàn cho dev/test

---

## Tài liệu tham khảo

- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [TikTok for Developers](https://developers.tiktok.com/)
- [Meta Platform Documentation](https://developers.facebook.com/docs/)
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api)
