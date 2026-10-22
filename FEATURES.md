# Tính Năng Social Auto - Tổng Kết Đầy Đủ

## 🎯 Tổng quan

Social Auto là công cụ self-hosted để quản lý và tự động đăng video lên các nền tảng mạng xã hội: YouTube, TikTok, Instagram, Facebook.

---

## 🌐 Web UI (React + Vite + Tailwind)

### Các trang chính (6 pages + 2 auth pages)

#### 0. **LoginPage / RegisterPage** - Xác thực
- Form đăng nhập / đăng ký (email + password)
- JWT token lưu trong localStorage, auto-redirect
- `ProtectedRoute` chặn truy cập trang khi chưa login

#### 1. **DashboardPage** - Trang chủ
- Hiển thị tổng quan hoạt động
- Thống kê bài đăng gần đây
- Quick actions
- Status overview

#### 2. **AccountsPage** - Quản lý tài khoản
- Xem danh sách tài khoản đã kết nối
- Kết nối tài khoản mới qua OAuth
- Filter theo platform (YouTube, TikTok, Facebook, Instagram)
- Hiển thị trạng thái tài khoản (active, expired)
- Chế độ xem: Card view / Table view
- Chỉnh sửa metadata tài khoản:
  - Display name
  - Content category
  - Language
  - Purpose
  - External link
- Xóa tài khoản đã kết nối
- Multi-account support (nhiều tài khoản cùng platform)

#### 3. **UploadPage** - Upload video
- Upload video file (drag & drop hoặc file picker)
- File validation:
  - Kiểm tra magic number (video formats)
  - Validate file size
  - Validate duration
  - Rejection invalid files
- Progress tracking real-time
- SHA256 deduplication (trùng file không upload lại)
- Thumbnail generation tự động với ffmpeg
- Quota tracking (kiểm tra giới hạn storage)
- Streaming upload support

#### 4. **SchedulePage** - Lên lịch đăng
- Xem danh sách bài đã lên lịch
- Lên lịch đăng bài mới:
  - Chọn video đã upload
  - Chọn tài khoản đích
  - Set thời gian đăng
  - Viết caption
  - Per-platform caption (caption riêng cho từng platform)
  - Chọn visibility (public, unlisted, private)
- Edit bài đã lên lịch
- Hủy bài đã lên lịch
- Filter theo status (pending, uploading, published, failed, dead)
- Date/time picker

#### 5. **HistoryPage** - Lịch sử đăng
- Xem lịch sử bài đã đăng
- Filter theo tài khoản
- Filter theo status
- Xem kết quả thực tế (external_post_id)
- Xem lỗi nếu có

#### 6. **AnalyticsPage** - Phân tích
- Thống kê hiệu suất từng tài khoản
- Channel metrics:
  - Subscribers
  - Views
  - Video count
  - Like count
  - Average watch seconds
  - Drop-off percentage
- Chart visualization (BarChart component)
- Snapshot data từ platform API

### UI Components
- **Layout**: Sidebar navigation, Topbar, Drawer
- **Card**: Content containers
- **Button**: Primary, secondary, danger styles
- **Badge**: Status indicators
- **Modal**: Dialogs và forms
- **Field**: Form inputs với validation
- **EmptyState**: Placeholder khi không có data
- **Skeleton**: Loading states
- **Toast**: Notifications
- **ErrorBoundary**: Error handling

---

## 🔌 API Backend (Fastify + SQLite)

### User Authentication Routes (multi-user, JWT)

- `POST /auth/register` - Đăng ký tài khoản (email + password + name), trả về JWT
- `POST /auth/login` - Đăng nhập, trả về JWT + user info
- `GET /auth/me` - Lấy thông tin user hiện tại (Bearer token)
- Password hash bằng scrypt, JWT ký bằng `JWT_SECRET`
- Tất cả resource routes (accounts, videos, schedule, dashboard, history) yêu cầu Bearer token và lọc theo `user_id`
- Resource endpoints kiểm tra ownership (403 nếu không phải chủ sở hữu)
- Web UI: `AuthProvider` + `ProtectedRoute`, trang `/login` + `/register`, nút logout trên Topbar
- `default-user` (seeded bởi migration) nhận ownership của dữ liệu legacy và của OAuth callbacks khi không có token

#### YouTube (Google OAuth)
- `GET /auth/youtube/start` - Bắt đầu OAuth flow
- `GET /auth/callback` - OAuth callback
- `GET /auth/youtube/status` - Kiểm tra trạng thái kết nối
- PKCE support
- Token exchange
- Refresh token management

#### TikTok OAuth
- `GET /auth/tiktok/start` - Bắt đầu TikTok OAuth
- `GET /auth/tiktok/callback` - TikTok callback
- PKCE S256 (required cho public clients)
- Token rotation

#### Meta (Facebook + Instagram) OAuth
- `GET /auth/meta/start` - Bắt đầu Meta OAuth
- `GET /auth/meta/callback` - Meta callback
- Long-lived token exchange (60 days)
- Page access tokens
- Instagram Business account linking

### Data Management Routes

#### Accounts
- `GET /accounts` - Lấy danh sách tài khoản
- `POST /accounts` - Kết nối tài khoản mới
- `PATCH /accounts/:id` - Cập nhật metadata
- `DELETE /accounts/:id` - Xóa tài khoản (CASCADE với scheduled_posts)
- Filter by platform
- Channel snapshot sync

#### Videos
- `POST /videos` - Upload video
- `GET /videos` - Lấy danh sách video
- `GET /videos/:id` - Lấy chi tiết video
- SHA256 deduplication
- File type detection
- Duration validation

#### Scheduled Posts
- `GET /schedule` - Lấy danh sách bài lên lịch
- `POST /schedule` - Tạo bài lên lịch mới
- `PATCH /schedule/:id` - Cập nhật bài
- `DELETE /schedule/:id` - Hủy bài
- Per-platform caption support
- Visibility settings

#### Storage & Quota
- `GET /quota` - Lấy quota info
- `GET /storage` - Lấy storage info
- Quota enforcement
- Storage quota tracking
- Orphaned file cleanup

#### Upload Progress
- `GET /upload-progress/:id` - Lấy progress upload
- Real-time tracking
- Progress persistence

#### Health Check
- `GET /health` - Health check endpoint
- Uptime tracking
- Worker status
- Account status summary

---

## ⚙️ Worker (Background Job Scheduler)

### Core Features
- Polling service (configurable interval)
- Claim due posts
- Dispatch to platform-specific publishers
- Token refresh lifecycle
- Error classification (retryable vs fatal)
- Retry logic with exponential backoff
- Dead post marking (account expired, unrecoverable errors)

### Publishers

#### YouTube Publisher
- Upload video to YouTube
- Set metadata (title, description, tags)
- Set visibility
- Handle quota limits
- Token refresh
- Error handling

#### TikTok Publisher
- Upload video to TikTok
- Set caption
- Token rotation
- PKCE flow support
- Error handling

#### Facebook Publisher
- Upload video to Facebook Page
- Set caption
- Page access token handling
- Long-lived token refresh

#### Instagram Publisher
- Upload video to Instagram
- Set caption
- Instagram Business account handling
- Page token → IG token flow

### Quota Management
- Platform-specific quota tracking
- Per-window tracking (UTC day)
- Quota enforcement
- Auto-reset on window boundary

### Storage Management
- Orphaned file cleanup
- Storage quota enforcement
- Disk space monitoring
- Periodic cleanup jobs

---

## 🗄️ Database (SQLite)

### Tables

#### users
Lưu tài khoản người dùng (multi-user auth):
- `id` - Primary key
- `email` - UNIQUE
- `password_hash` - scrypt hash
- `name` - Tên hiển thị
- `created_at` - Creation timestamp

#### accounts
Lưu thông tin tài khoản mạng xã hội:
- `user_id` - FK to users (CASCADE delete)
- `id` - Primary key
- `platform` - YouTube, TikTok, Facebook, Instagram
- `external_id` - Platform-specific ID (channel ID, user ID, etc.)
- `display_name` - Tên hiển thị
- `oauth_refresh_token` - Refresh token (encrypted)
- `oauth_access_token` - Access token (encrypted)
- `token_expires_at` - Token expiry timestamp
- `status` - active, expired
- `content_category` - Category tag (e.g., "tech")
- `language_code` - ENGLISH, VIETNAMESE, or empty
- `purpose` - Mục đích tài khoản
- `link` - External link
- `channel_handle` - Channel handle (@username)
- `avatar_url` - Avatar URL
- `subscribers` - Subscriber count
- `views` - Total view count
- `video_count` - Video count
- `like_count` - Like count
- `avg_watch_seconds` - Average watch time
- `drop_off_pct` - Drop-off percentage
- `last_sync_at` - Last sync timestamp

#### videos
Lưu thông tin video đã upload:
- `id` - Primary key
- `user_id` - FK to users (CASCADE delete)
- `file_path` - Đường dẫn file
- `sha256` - File hash (deduplication)
- `size_bytes` - File size
- `duration_sec` - Video duration
- `mime` - MIME type
- `thumbnail_path` - Thumbnail path
- `created_at` - Upload timestamp

#### scheduled_posts
Lưu bài đã lên lịch:
- `id` - Primary key
- `user_id` - FK to users (CASCADE delete)
- `video_id` - FK to videos
- `account_id` - FK to accounts (CASCADE delete)
- `scheduled_at` - Thời gian đăng
- `caption` - Caption chính
- `per_platform_caption` - Caption riêng từng platform
- `visibility` - public, unlisted, private
- `status` - pending, uploading, published, failed, dead
- `external_post_id` - Platform post ID
- `last_error` - Error message
- `retry_count` - Số lần retry
- `next_retry_at` - Thời gian retry tiếp
- `is_dead` - Mark as unrecoverable
- `created_at` - Creation timestamp
- `updated_at` - Update timestamp

#### quotas
Lưu quota usage:
- `id` - Primary key
- `platform` - Platform
- `window_start` - Window start timestamp
- `used` - Units used
- `limit` - Quota limit
- `updated_at` - Update timestamp
- UNIQUE(platform, window_start)

#### schema_migrations
Theo dõi database migrations:
- `id` - Migration ID
- `applied_at` - Applied timestamp

### Migrations
- 0001: Initial schema
- 0002: Quota FK and indexes
- 0003: Quota table
- 0004: Multi-account external_id
- 0005: Account metadata and channel snapshot
- 0006: Analytics channel fields
- 0007: Claim pending due index
- 0008: Quotas unique per window
- 0009: Scheduled posts account cascade
- 0010: User authentication (users table + user_id FK trên accounts/videos/scheduled_posts)
- 0011: Seed `default-user` (placeholder user cho dữ liệu legacy + repository fallbacks)

---

## 🔒 Security Features

### User Authentication
- **scrypt password hashing** với per-user salt
- **JWT (HS256)** cho session tokens, ký bằng `JWT_SECRET`
- Auth middleware bắt buộc trên tất cả resource routes
- Optional auth middleware trên OAuth callbacks (gán account cho user đang login)
- Per-user data isolation qua `user_id` foreign keys + ownership checks (403)
- Web UI route guards (`ProtectedRoute`) + token persistence trong localStorage

### Token Management
- **AES-256-GCM encryption** cho tất cả OAuth tokens
- Token encryption key (32-byte hex) from env
- Tokens stored encrypted at rest
- Auto refresh 60s trước khi hết hạn
- Refresh token rotation (TikTok)

### OAuth Security
- PKCE S256 (TikTok, YouTube)
- State parameter validation
- Cookie-based state storage
- Secure cookie flags (httpOnly, sameSite)
- Host header injection prevention

### Environment Security
- Environment variables cho sensitive config
- `.env.local` gitignored
- Pre-commit hooks detect secrets
- No hardcoded credentials

---

## 🧪 Testing

### Test Coverage
- **234 tests** passing
- **API**: 145 tests (14 test files)
- **Worker**: 65 tests (8 test files)
- **Web**: 24 tests (3 test files)

### Test Types
- Unit tests
- Integration tests
- OAuth flow tests
- File validation tests
- Storage management tests
- Quota management tests
- YouTube upload tests
- Token lifecycle tests

### Mock Clients
- Mock Google OAuth client
- Mock TikTok OAuth client
- Mock Meta OAuth client
- Mock publishers
- Safe for CI/CD và dev

---

## 📦 Shared Utilities

### Crypto Utils
- AES-256-GCM encryption/decryption
- Random key generation
- Token encryption

### Types
- Platform types
- Account types
- Post types
- Error types

### Database
- Schema definitions
- Migration system
- Repository patterns

---

## 🔧 Configuration

### Environment Variables
- `TOKEN_ENCRYPTION_KEY` - Required cho encryption
- `USE_MOCK_GOOGLE` - Mock mode flag
- `USE_MOCK_PUBLISHERS` - Mock publishers flag
- `USE_MOCK_TIKTOK` - Mock TikTok flag
- `USE_MOCK_META` - Mock Meta flag
- Google OAuth credentials (optional in mock mode)
- TikTok credentials (optional in mock mode)
- Meta credentials (optional in mock mode)
- Storage quota settings
- Worker poll interval
- Upload concurrency

### Modes
- **Mock Mode**: Dev/test không cần credentials
- **Real Mode**: Sử dụng credentials thực tế

---

## 🚀 Deployment Ready

### Build System
- TypeScript compilation
- Vite build cho web
- Dist output cho production
- PM2 ecosystem config (removed in cleanup, but ready to add)

### Database
- SQLite (file-based)
- Schema migrations
- Automatic migrations on startup
- Backup support (scripts removed, but schema supports)

### Monitoring
- Health check endpoint
- Sentry integration (optional)
- Error tracking
- Logging with Pino

---

## 📝 Trạng thái hiện tại

### ✅ Hoàn thành
- Tất cả UI pages
- Tất cả API routes
- Tất cả publishers
- Database schema hoàn chỉnh
- Token encryption
- Token refresh lifecycle
- Quota management
- Storage management
- Test coverage đầy đủ
- Mock clients (dev mode)
- Real clients (chờ credentials)

### ⚠️ Cần credentials
- YouTube (Google OAuth)
- TikTok (yêu cầu partner review)
- Meta (Facebook/Instagram)

Xem [API_CREDENTIALS_GUIDE.md](./API_CREDENTIALS_GUIDE.md) để thiết lập.

---

## 🎨 Tech Stack

- **Backend**: Fastify + SQLite
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Worker**: Background job scheduler
- **Package Manager**: pnpm workspaces
- **Language**: TypeScript 5.x
- **Testing**: Vitest
- **Database**: SQLite (sql.js)
- **Crypto**: Node.js crypto module
- **Video Processing**: fluent-ffmpeg

---

## 📊 Tóm tắt

Dự án có đầy đủ tính năng để vận hành production:
- ✅ Multi-user authentication (JWT + user isolation)
- ✅ Complete OAuth integration (chờ credentials)
- ✅ Full UI với 6 pages + login/register
- ✅ Complete API với 13+ routes
- ✅ Worker với 4 publishers
- ✅ Database schema với 5 tables
- ✅ Security (encryption, PKCE)
- ✅ Test coverage (234 tests)
- ✅ Mock mode cho dev/test
- ✅ Production-ready build

**Thiếu duy nhất**: API credentials từ từng platform (xem API_CREDENTIALS_GUIDE.md)
