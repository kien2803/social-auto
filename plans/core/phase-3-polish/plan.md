# Phase 3 — Polish

**Goal**: Tool chạy ổn định cho dùng cá nhân lâu dài: retry, rate limit tracking, UI polish.

**Status**: done (2026-09-04)
**Estimate**: M (2-3 days)
**Depends on**: Phase 2

## Tasks

- [x] **T3.1** Retry với exponential backoff
  - Schedule retry: `next_retry_at = now + 2^n minutes` (n = số lần đã retry, max 5).
  - Sau 5 lần → `status='dead'`, show trong dashboard.

- [x] **T3.2** Rate limit tracking
  - UI dashboard hiện "YouTube: 4500/10000 units today".
  - Block upload nếu quota còn <1 lần upload.

- [x] **T3.3** Preview trước khi schedule
  - Edit trực tiếp trong preview.

- [x] **T3.4** History + analytics
  - CSV export.

- [x] **T3.5** Auto-start worker
  - `pm2` hoặc `node-windows` để chạy worker như service.
  - Auto-start khi boot Windows.
  - Log rotation.

- [x] **T3.6** Health check + monitoring
  - `GET /health` endpoint trả status của worker, last successful upload, account statuses.
  - Local notification khi post fail (system notification Windows).

## Shared contracts

```ts
// packages/shared/src/db/schema.ts (new columns)
ScheduledPost {
  ...
  retry_count: int (default 0),
  next_retry_at: timestamp (nullable),
  is_dead: boolean (default false),
}

// packages/shared/src/types/quota.ts
interface QuotaState {
  platform: Platform;
  used: number;
  limit: number;
  reset_at: timestamp;
}
```

## Out of scope
- Analytics nâng cao (engagement tracking, A/B test).
- Auto-reply to comments.
- Cloud deploy.
- Team features (multi-user).

## Risks
- Retry có thể đăng trùng nếu API không idempotent → YouTube `videos.insert` chấp nhận `autoLevels`+`notifySubscribers` flags, không có idempotency key. Mitigation: lưu `external_post_id` ngay khi upload start, check trước khi retry.
- Worker crash giữa upload → row stuck ở `uploading`. Mitigation: startup scan, set rows `uploading` quá 30 phút về `failed`.

## Acceptance check
- [ ] Fake fail upload 3 lần → retry thành công ở lần 4.
- [ ] Fake fail upload 6 lần → `status='dead'`, không retry nữa.
- [ ] Dashboard hiện quota chính xác (compare với YouTube API).
- [ ] Block upload khi quota gần cạn.
- [ ] Preview modal đúng caption mỗi platform.
- [ ] Worker auto-restart sau khi kill process.
- [ ] Health check trả JSON đầy đủ fields.