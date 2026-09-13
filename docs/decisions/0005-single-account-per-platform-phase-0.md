# ADR-0005: Một tài khoản mỗi nền tảng trong Phase 0

## Trạng thái
Đã chấp nhận

## Ngày
2026-08-28

## Bối cảnh

`social-auto` cuối cùng cần hỗ trợ nhiều tài khoản mỗi nền tảng — creator có 2 kênh YouTube, agency quản lý 5 client. Data model phải cho phép từ ngày đầu, nếu không sau này migration rất đau.

Nhưng Phase 0 là bootstrap: chứng minh flow OAuth chạy end-to-end trước khi build UI chọn account, switch account, hay schedule theo account.

Hai hướng:

- **Build schema và UI multi-account luôn**. Đúng nghiêm ngặt, nhưng là việc Phase 2 nhét vào Phase 0.
- **Build single-account với đường migration rõ ràng**. Nhanh; schema và route có thể mở rộng mà không vỡ flow OAuth.

## Quyết định

Phase 0 hỗ trợ **đúng một tài khoản mỗi nền tảng**. Schema đã cho phép nhiều:

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,    -- 'youtube' | 'tiktok' | 'instagram' | 'facebook'
  display_name TEXT NOT NULL,
  ...
);
```

Không có UNIQUE constraint trên `platform`. Ràng buộc "một tài khoản" nằm ở route handler:

```ts
// apps/api/src/routes/auth.ts — callback handler
const existing = deps.accounts.findByPlatform('youtube');
if (existing) {
  // re-authorize: cập nhật access token, giữ refresh token cũ
  deps.accounts.updateTokens(existing.id, { access_token, expires_at });
} else {
  // lần đầu: insert row mới
  deps.accounts.insert({ platform: 'youtube', ... });
}
```

Method `findByPlatform` của repo dùng `ORDER BY created_at DESC LIMIT 1`, nên khi có nhiều row (Phase 2) thì mặc định lấy cái mới nhất — UI có thể pick cái cũ một cách tường minh.

Phase 2 gỡ ràng buộc: thêm UI chọn account, đổi route để insert row mới key theo `(platform, external_id)` thay vì upsert theo platform.

## Các phương án đã xét

### Multi-account từ ngày đầu
- **Ưu**: Không migration; khớp hình dài hạn.
- **Nhược**: UI picker account, API list account, UI account detail, đặt tên, xóa — toàn việc Phase 0 cho user Phase 0 không cần.
- **Loại**: Phase 0 có 1 user (developer), 1 kênh YouTube. Multi-account giá trị bằng 0 đến khi có upload.

### UNIQUE constraint trên `platform`
- **Ưu**: Database enforce single-account.
- **Nhược**: Ép migration schema ở Phase 2 (drop constraint, migrate data).
- **Loại**: Migration dễ làm bằng code bây giờ, đỡ phải nhảy schema sau.

### Không bảng accounts — lưu token trong file config
- **Ưu**: Còn đơn giản hơn.
- **Nhược**: Không scale sang multi-account; vỡ abstraction Phase 2 cần.
- **Loại**: Bảng accounts là nền tảng cho FK `scheduled_posts.account_id`.

## Hệ quả

### Tích cực
- Đường nhanh nhất tới OAuth flow chạy được. Pattern `findByPlatform` + upsert trong repo < 30 dòng.
- Schema đã multi-row capable. Bản thân shape bảng không cần migration tương lai.
- Việc Phase 2 hoàn toàn additive: UI chọn account để post, đổi route, không phải rewrite schema.

### Tiêu cực
- **Gây hiểu nhầm cho user có nhiều kênh**. Kênh YouTube thứ hai lặng lẽ ghi đè access token của cái thứ nhất. Giảm bằng cách ghi limitation trong [`docs/features/youtube-oauth.md`](../features/youtube-oauth.md) và chưa expose UI multi-account.
- **Đường "update tokens on re-auth" có tính hủy diệt**. Nếu user tưởng đang thêm kênh thứ hai mà thật ra re-authorize cùng kênh, refresh token gốc được giữ (không ghi đè) nên vẫn refresh được — nhưng channel name giờ phản ánh consent mới nhất.

### Trung tính
- Cột `status` (`active` / `expired` / `revoked`) chưa dùng ở Phase 0 (row luôn `'active'` lúc insert). Để đó vì phase sau cần.

## Tham khảo

- Schema: [`packages/shared/src/db/schema.ts`](../../packages/shared/src/db/schema.ts)
- Logic upsert: [`apps/api/src/routes/auth.ts`](../../apps/api/src/routes/auth.ts) (callback handler)
- Repository: [`apps/api/src/repositories/accounts.ts`](../../apps/api/src/repositories/accounts.ts)
- Feature doc: [`docs/features/youtube-oauth.md`](../features/youtube-oauth.md) — mục Limitations.
