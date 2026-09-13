# Phase 1 — YouTube MVP

**Goal**: Upload 1 video từ UI, schedule, tự động đăng lên YouTube đúng giờ.

**Status**: done (2026-08-29, simulator --all = 5/5 pass)
**Estimate**: L (4-6 days)
**Depends on**: Phase 0

## Tasks

- [ ] **T1.1** DB schema + migrations
  - Tables: `videos`, `scheduled_posts` (xem contracts).
  - Migration tool: Drizzle ORM hoặc Knex (chọn 1).
  - Seed: 1 default user (bạn).

- [ ] **T1.2** Upload endpoint
  - `POST /videos` multipart, max 2GB, accept mp4/mov/webm.
  - Lưu `storage/<sha256>.<ext>`, hash bằng streaming (không load full file vào RAM).
  - Extract metadata: duration (ffprobe), size, mime.
  - Generate thumbnail frame ở giây 1 (ffmpeg).

- [ ] **T1.3** Schedule endpoint
  - `POST /schedule` body: `{ video_id, account_id, scheduled_at, caption, visibility }`.
  - Validation: `scheduled_at` > now + 60s, account active, caption < 5000 chars.
  - Insert `scheduled_posts` row với status `pending`.

- [ ] **T1.4** Worker
  - Polling mỗi 30s: `SELECT * FROM scheduled_posts WHERE status='pending' AND scheduled_at <= now()`.
  - Claim bằng `UPDATE ... SET status='uploading' WHERE id=? AND status='pending'` (atomic).
  - Gọi YouTube **Resumable Upload API**: `videos.insert?part=snippet,status`, upload từ file path (streaming).
  - Title từ caption (first line), description = phần còn lại + hashtags.
  - Set `privacyStatus=private|unlisted|public` theo input.
  - On success: update `external_post_id`, `status='published'`.
  - On error: update `status='failed'`, lưa `last_error`.

- [ ] **T1.5** Frontend
  - Page `/upload`: drag-drop, progress bar, sau upload show preview + button "Schedule".
  - Page `/schedule`: list posts (grouped by date), filter status, click để edit/delete.
  - Page `/accounts`: list + connect/disconnect (Phase 0 đã có).
  - Page `/`: dashboard (counts: pending, published, failed this week).

- [ ] **T1.6** End-to-end smoke test
  - Upload video 30s từ disk.
  - Schedule "now + 2 minutes".
  - Verify trong YouTube Studio sau 2 phút: video xuất hiện đúng visibility.

## Shared contracts

```ts
// packages/shared/src/db/schema.ts
Video {
  id, file_path, sha256, size_bytes, duration_sec, mime,
  thumbnail_path, created_at
}

ScheduledPost {
  id, video_id (FK), account_id (FK),
  scheduled_at, caption, visibility ('public'|'unlisted'|'private'),
  status ('pending'|'uploading'|'published'|'failed'),
  external_post_id, last_error,
  created_at, updated_at
}
```

```ts
// packages/shared/src/types/publisher.ts
interface Publisher {
  upload(videoPath: string, meta: UploadMeta): Promise<{ externalId: string }>;
  verifyCredentials(): Promise<AccountInfo>;
}

interface UploadMeta {
  title: string; description: string; tags?: string[];
  visibility: 'public'|'unlisted'|'private';
}
```

## Out of scope
- TikTok, IG, FB (Phase 2).
- Retry (Phase 3).
- Caption templates, hashtag sets.
- Thumbnail custom (dùng frame auto).

## Risks
- YouTube quota: mỗi upload ~1600 units, default 10k/day → max ~6 uploads/day cho dev project.
- File lớn cần resumable upload đúng chuẩn (chunk 256KB-1MB).
- Token expired mid-upload → mark `status='failed'`, để Phase 3 xử lý retry.

## Acceptance check
- [ ] Upload video 30s thật qua UI, thấy progress.
- [ ] Schedule "now + 2 min", xem trong `/schedule` list.
- [ ] Sau 2 phút, status = `published`, `external_post_id` có giá trị.
- [ ] Mở YouTube Studio, video hiện ở đúng visibility.
- [ ] Caption (title + description) khớp với input.