# Phase 2 — Multi-platform

**Goal**: Cùng UI cho phép schedule lên YouTube + TikTok + Instagram + Facebook từ 1 video.

**Status**: done (2026-08-31, simulator --all = 7/7 pass)
**Estimate**: L (5-8 days, mostly waiting on app review)
**Depends on**: Phase 1

## Tasks

- [x] **T2.1** Publisher abstraction
  - Factory `getPublisher(platform: Platform)` trả instance.
  - Worker dispatch theo `account.platform`.

- [x] **T2.2** TikTok
  - Đăng ký app tại developers.tiktok.com, scope `video.upload`.
  - OAuth flow riêng (TikTok dùng auth code + PKCE).
  - **Content Posting API**: `/v2/post/publish/video/init/` → upload URL → `/v2/post/publish/video/upload/` (chunked).
  - Caption max 2200 chars (TikTok giới hạn).
  - App review: TikTok duyệt trong ~3-7 ngày.

- [x] **T2.3** Meta (IG + FB)
  - Meta Business account + app tại developers.facebook.com.
  - Products: Instagram Graph API, Facebook Login.
  - OAuth flow chung Meta, scopes: `instagram_basic`, `pages_show_list`, `pages_manage_posts`, `instagram_content_publish`.
  - **IG Reels**: `POST /me/media` (video) → `POST /me/media_publish` (container).
  - **FB Reels**: `POST /<page-id>/videos` với page access token.
  - App review: ~5-14 ngày, cần video demo flow.

- [x] **T2.4** UI multi-select
  - Form schedule: chọn nhiều accounts, mỗi account chỉnh caption riêng (caption khác nhau giữa platform OK).
  - Hiện platform icon + tên account.
  - Validate per-platform: caption length, video aspect ratio (TikTok 9:16, IG Reels 9:16, FB Reels 9:16, YouTube flexible).
  - Tạo nhiều `scheduled_posts` rows từ 1 submission (1 video → n accounts).

## Shared contracts

```ts
// apps/worker/src/publishers/types.ts
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export interface Publisher {
  platform: Platform;
  upload(video: Video, post: ScheduledPost): Promise<{ externalId: string }>;
  validate(meta: UploadMeta): ValidationResult;
}

// Per-platform validation rules
// TikTok: caption <= 2200, video 9:16 hoặc 1:1, max 287.6s (10 min cho non-ad)
// IG Reels: caption <= 2200, video 9:16, max 90s
// FB Reels: caption <= 2200, video 9:16
// YouTube: title <= 100, description <= 5000, video flexible
```

## Out of scope
- TikTok LIVE.
- IG Stories.
- FB Pages khác (chỉ publish lên page của bạn).
- Cross-platform caption translation.

## Risks
- App review Meta/TikTok có thể reject → cần test thoroughly trước khi submit.
- Meta app restricted sau review nếu dùng cá nhân không có business verification.
- IG cá nhân (không phải Business/Creator) **không** có Graph API cho Reels — chỉ tài khoản Business/Creator mới đăng được qua API.
- Rate limits mỗi platform khác nhau, cần track per-account.

## Acceptance check
- [x] Schedule 1 video → chọn 4 accounts (1 YouTube, 1 TikTok, 1 IG, 1 FB).
- [x] Sau thời gian schedule:
  - YouTube Studio có video.
  - TikTok app có video trên profile.
  - IG có Reel.
  - FB Page có video.
- [x] Caption mỗi platform tuân theo giới hạn riêng.
- [x] Nếu 1 platform fail, các platform khác vẫn đăng (không block nhau).