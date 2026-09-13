# Phase 2 — Tests

## T2.1 Abstraction

| Test | Type | Expected |
|---|---|---|
| `getPublisher('youtube')` trả YouTubePublisher | unit | instance match |
| Worker dispatch đúng publisher theo platform | unit | Mock từng publisher, verify được gọi |
| Publisher interface có đủ 2 methods | unit (compile) | TS compile pass |

## T2.2 TikTok

| Test | Type | Expected |
|---|---|---|
| OAuth flow lưu được refresh token | integration | DB row có token, `verifyCredentials` trả user info |
| Video 30s upload thành công | integration | `externalId` trả về |
| Caption > 2200 chars bị reject trước khi upload | unit | Validation fail, không gọi API |
| Video aspect 16:9 bị reject (TikTok chỉ 9:16/1:1) | unit | Validation fail |
| Token expired → status `expired`, UI hiện re-connect | integration | Account row updated |

## T2.3 Meta

| Test | Type | Expected |
|---|---|---|
| OAuth Meta trả page access token + IG account ID | integration | Lưu vào DB |
| IG Reel 30s publish thành công | integration | `externalId` (media_id) trả về |
| FB Reel 30s publish thành công | integration | `externalId` (video_id) trả về |
| Container status `IN_PROGRESS` → poll cho tới `FINISHED` | unit (mock) | Polling logic đúng |
| IG account là personal (không business) bị reject | unit | Error message rõ |

## T2.4 Multi-select UI

| Test | Type | Expected |
|---|---|---|
| Chọn 4 accounts → 4 rows trong `scheduled_posts` | e2e | DB có 4 rows, cùng `video_id` |
| Caption khác nhau per account được lưu riêng | e2e | Mỗi row có caption riêng |
| Caption TikTok > 2200 → chỉ YouTube/IG/FB schedule | e2e | UI block + giải thích |
| 1 platform fail trong worker → các platform khác vẫn chạy | integration | 3 publish success, 1 failed, không block |

## E2E multi-platform

| Test | Type | Expected |
|---|---|---|
| Upload video 30s → chọn 4 accounts → schedule + 5min | manual | Tất cả 4 platform có video sau 5 phút |
| Validate visual + caption trên mỗi platform | manual | Match expected |