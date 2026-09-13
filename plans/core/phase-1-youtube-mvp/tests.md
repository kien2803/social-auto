# Phase 1 — Tests

## T1.1 Schema

| Test | Type | Expected |
|---|---|---|
| Migration up tạo đủ tables | unit | `videos`, `scheduled_posts`, `accounts` tồn tại |
| Migration down drop hết | unit | DB empty |
| Migration idempotent | unit | Chạy 2 lần không lỗi |

## T1.2 Upload

| Test | Type | Expected |
|---|---|---|
| `POST /videos` với file 30s mp4 | integration | 201, body có `id`, `sha256`, `duration_sec` ≈ 30 |
| File >2GB bị reject | unit | 413 Payload Too Large |
| MIME không phải video bị reject | unit | 415 Unsupported Media Type |
| Upload 2 file cùng nội dung → cùng sha256 | unit | Hash khớp |
| Thumbnail file tồn tại trên disk | integration | `storage/<sha256>.jpg` tồn tại, size > 0 |
| Streaming hash không load full file vào RAM | manual (perf) | RAM delta < 200MB khi upload 1GB |

## T1.3 Schedule

| Test | Type | Expected |
|---|---|---|
| `POST /schedule` với data hợp lệ | integration | 201, row trong DB với status `pending` |
| `scheduled_at` < now+60s bị reject | unit | 400 với message rõ |
| account `status=expired` bị reject | unit | 400 |
| caption > 5000 chars bị reject | unit | 400 |
| account_id không tồn tại | unit | 404 |

## T1.4 Worker

| Test | Type | Expected |
|---|---|---|
| Polling pick đúng posts đến hạn | unit (mock clock) | Chỉ claim rows có `scheduled_at <= now` |
| Claim atomic — 2 worker chạy song song không claim trùng | integration (race) | Mỗi row chỉ update 1 lần |
| Upload success → status `published`, `external_post_id` set | integration | DB row match |
| Upload fail (API 5xx) → status `failed`, `last_error` populated | integration (mock) | DB row có error message |
| Visibility `unlisted` set đúng trong API call | unit (mock) | Request body match |
| Title từ caption first line, description = phần còn lại | unit | Đúng cho input mẫu |

## T1.5 Frontend

| Test | Type | Expected |
|---|---|---|
| Drag-drop file 30s hiện progress | e2e (Playwright) | Bar chạy 0→100% |
| Upload xong → preview thumbnail + form schedule | e2e | Hiện đúng |
| Schedule list group by date | e2e | Post "now+2min" hiện ở today |
| Edit post pending update DB | e2e | Row updated |
| Delete post pending remove khỏi DB | e2e | Row deleted |

## T1.6 E2E

| Test | Type | Expected |
|---|---|---|
| Upload + schedule + verify YouTube Studio | manual | Video hiện sau ~2 min với đúng visibility |
| Worker restart không mất posts pending | manual | Kill worker giữa chừng, restart, post vẫn đăng |
| Mất mạng giữa upload → status failed, retry tay (Phase 3 sẽ auto) | manual | DB status = failed |

## Test tooling
- Unit: Vitest
- Integration: Vitest + supertest + test SQLite in-memory
- E2E: Playwright cho web
- Mock: MSW hoặc custom fetch mock cho YouTube API