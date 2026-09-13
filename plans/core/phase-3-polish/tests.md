# Phase 3 — Tests

## T3.1 Retry

| Test | Type | Expected |
|---|---|---|
| Fail 1 lần → retry sau 2 phút | unit (mock clock) | `next_retry_at` = now + 2min |
| Fail 3 lần → retry sau 8 phút | unit | exponential: 2, 4, 8 |
| Fail 5 lần → status `dead` | unit | `is_dead=true`, không schedule retry |
| Non-retryable error (4xx auth) → không retry | unit | Status ngay `failed`, no `next_retry_at` |

## T3.2 Rate limit

| Test | Type | Expected |
|---|---|---|
| Sau upload, quota used tăng đúng | integration | DB match API response |
| Upload khi quota < 1 unit → reject trước | unit | 400 với message quota |
| Dashboard render quota đúng | e2e | UI match DB |

## T3.3 Preview

| Test | Type | Expected |
|---|---|---|
| Modal hiện video player + caption per platform | e2e | Tất cả platform hiện đúng |
| Edit caption trong modal update form state | e2e | Confirm modal → schedule dùng caption đã edit |

## T3.4 History + CSV

| Test | Type | Expected |
|---|---|---|
| Filter by status=published | e2e | Chỉ hiện published |
| Filter by date range | e2e | Đúng range |
| Export CSV tải file đúng schema | e2e | File download có header + rows |

## T3.5 Auto-start

| Test | Type | Expected |
|---|---|---|
| Kill worker → tự restart trong < 30s | manual | Process lại chạy |
| Reboot Windows → worker auto-start | manual | Sau login, worker ready |
| Log file rotate khi > 10MB | manual | File mới tạo, file cũ rename .log.1 |

## T3.6 Health + notifications

| Test | Type | Expected |
|---|---|---|
| `GET /health` trả JSON đủ fields | unit | `worker.status`, `accounts[]`, `last_publish_at` |
| Post fail → Windows notification hiện | manual | Toast notification trong 5s |
| Notification click → mở app tới post đó | manual | Deep link đúng |

## E2E stability

| Test | Type | Expected |
|---|---|---|
| Chạy 24h liên tục, 5 scheduled posts | manual | Tất cả đăng đúng lịch, không crash |
| Tắt/mở máy 3 lần trong tuần | manual | Worker recover, posts không bị mất |