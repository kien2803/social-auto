# ADR-0003: Mã hóa AES-256-GCM cho OAuth token khi lưu

## Trạng thái
Đã chấp nhận

## Ngày
2026-08-28

## Bối cảnh

OAuth refresh token là credential sống lâu, cấp quyền truy cập liên tục vào tài khoản YouTube của user. Nếu file SQLite bị lộ (mất laptop, leak backup, commit nhầm), token sẽ đọc được ở dạng plaintext.

Cần mã hóa đối xứng:

- Thuật toán chuẩn ngành, đã được audit, có sẵn trong Node stdlib.
- Authenticated encryption (phát hiện tamper) — chặn attacker hoán đổi ciphertext giữa các row.
- Key từ biến môi trường (không hardcode, không lưu trong DB).
- Format round-trip được qua cột TEXT của SQLite.

## Quyết định

Dùng **AES-256-GCM** qua module `crypto` có sẵn của Node (`createCipheriv` / `createDecipheriv`). Export từ `packages/shared/src/utils/crypto.ts` thành `encrypt(plaintext, keyHex)` và `decrypt(payload, keyHex)`.

Yêu cầu về key:
- 32 bytes (64 hex chars).
- Đọc từ env `TOKEN_ENCRYPTION_KEY`.
- Generate một lần lúc cài; lưu trong `.env.local` (gitignored).

Format output: `iv:tag:ciphertext` — 3 đoạn hex nối bằng dấu `:`.
- IV: 12 byte random mỗi lần gọi (chuẩn GCM).
- Tag: auth tag GCM, 16 byte.
- Ciphertext: độ dài thay đổi.

```ts
export function encrypt(plaintext: string, keyHex: string): string {
  // trả về "<iv-hex>:<tag-hex>:<ciphertext-hex>"
}
```

## Các phương án đã xét

### AES-256-CBC + HMAC
- **Ưu**: Hơi nhanh hơn; nhiều ví dụ có sẵn.
- **Nhược**: Không authenticated — phải kết hợp HMAC-SHA256 theo pattern encrypt-then-MAC, dễ sai (nonce reuse, thứ tự verify).
- **Loại**: GCM làm cả hai trong một primitive với một key.

### libsodium / `sodium-native`
- **Ưu**: API hiện đại, primitive đã audit, dễ dùng đúng.
- **Nhược**: Thêm dependency native (sodium-native cần compile); libsodium-wrappers pure JS nhưng nặng.
- **Loại**: `crypto.createCipheriv('aes-256-gcm', ...)` có sẵn trong Node stdlib, đã audit, không tốn cài đặt.

### Per-row key derive từ master key
- **Ưu**: Giới hạn blast radius nếu key một row lộ.
- **Nhược**: Thêm phức tạp (HKDF, rotation, key ID) cho tool single-user. Quá tay.
- **Loại**: Không tương xứng threat model.

### Lưu token trong OS keychain (keytar / `node-keytar`)
- **Ưu**: Best-practice lưu trữ credential cấp OS.
- **Nhược**: Server headless (Docker, VPS) thường không có keychain; hành vi cross-platform khác nhau; thêm native dependency.
- **Loại**: Kẹt triển khai ở những kịch bản project nhắm vào.

### Plaintext với permission filesystem
- **Ưu**: Zero phức tạp.
- **Nhược**: Không chống disk image bị đánh cắp, upload nhầm, hay process lạ đọc được.
- **Loại**: Không đạt chuẩn "OAuth token của user".

## Hệ quả

### Tích cực
- Primitive chuẩn, đã audit. Không dependency ngoài.
- Authenticated — lật bit trong ciphertext làm `decrypt()` throw.
- Cùng format đọc/ghi qua các process — không lo migration nếu key giữ nguyên.

### Tiêu cực
- **Mất key = mất token**. Nếu `TOKEN_ENCRYPTION_KEY` mất, mọi token không đọc được; mọi user phải authorize lại. Giảm bằng cách ghi rõ trong `.env.example`.
- **Không hỗ trợ rotation key**. Rotation cần 1 lần re-encrypt: đọc tất cả row, decrypt bằng key cũ, encrypt lại bằng key mới, ghi lại. Ghi vào backlog Phase 3+.
- **Decrypt mỗi lần đọc** tốn chút CPU. Ở scale này không đáng kể.

### Trung tính
- Module crypto nằm trong `packages/shared/` nên worker (Phase 1) cũng đọc token bằng cùng helper — không có implementation thứ hai để drift.

## Tham khảo

- Implementation: [`packages/shared/src/utils/crypto.ts`](../../packages/shared/src/utils/crypto.ts)
- Cách dùng: [`apps/api/src/routes/auth.ts`](../../apps/api/src/routes/auth.ts) — `encrypt()` ở callback, `decrypt()` ở `/status`.
- Tạo key: hướng dẫn trong [`.env.example`](../../.env.example).
