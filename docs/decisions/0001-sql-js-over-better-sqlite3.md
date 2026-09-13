# ADR-0001: Dùng sql.js cho SQLite (thay vì better-sqlite3)

## Trạng thái
Đã chấp nhận

## Ngày
2026-08-28

## Bối cảnh

`social-auto` là tool self-hosted, chạy 1 process cho 1 người dùng. Tầng dữ liệu cần:

- Là database quan hệ thật (data có quan hệ FK: `scheduled_posts` → `videos`, `scheduled_posts` → `accounts`).
- Sống sót qua các lần restart process (flow OAuth cần load lại token đã lưu).
- Chạy trên Windows, macOS, Linux không cần bước build theo platform.
- Nhúng được vào process Node, không cần chạy service ngoài.

Các lựa chọn tự nhiên:

- **better-sqlite3** — binding SQLite nhanh nhất cho Node. Native, cần `node-gyp` / prebuilt binary cho mỗi version Node.
- **sql.js** — SQLite compile sang WebAssembly, chạy thuần JS. Query chậm hơn, nhưng không cần build native.

Team muốn `pnpm install` một lần là chạy được trên mọi máy contributor và CI mà không cần compiler.

## Quyết định

Dùng **sql.js** làm engine SQLite.

Chấp nhận chậm hơn (~5-10× so với better-sqlite3 cho write) vì workload single-user, write rất ít — quan trọng là install không bao giờ vỡ.

## Các phương án đã xét

### better-sqlite3
- **Ưu**: Nhanh nhất; API đồng bộ; triển khai nhiều.
- **Nhược**: Cần `node-gyp` + C++ toolchain, hoặc prebuilt binary hay lạc hậu so với Node mới. Trên Windows hay vỡ với `gyp ERR! find Python` rất khó debug.
- **Loại**: Flow OAuth Phase 0 chỉ có 1 INSERT mỗi lần connect. Hiệu năng không phải ràng buộc; độ tin cậy khi install mới là.

### Prisma + SQLite
- **Ưu**: Schema-first; migration đẹp; DX tốt.
- **Nhược**: Cần bước generate client; bundle nặng; phải học data model Prisma. Quá tay cho 3 bảng.
- **Loại**: Thêm bước build + abstraction không cần thiết.

### Postgres
- **Ưu**: DB production thật; nhiều tính năng.
- **Nhược**: Phải chạy process riêng; project cố tình single-process self-hosted.
- **Loại**: Vận hành nặng hơn use case cần.

### LowDB / file JSON
- **Ưu**: Cực dễ.
- **Nhược**: Không ACID, không FK, không concurrent-read an toàn. Data model có FK constraint.
- **Loại**: Sẽ vỡ ngay khi 2 write race nhau.

## Hệ quả

### Tích cực
- `pnpm install` chạy ngon trên máy mới, không cần bước phụ.
- Test (`:memory:`) và production (file path) đi cùng code path.
- Không có binary native phải rebuild khi đổi version Node.

### Tiêu cực
- **Phải gọi `flush()` (hoặc wrap write) để persist**. sql.js mặc định in-memory; persist phải tường minh. Pattern đang dùng: wrap `Database.run` / `Database.exec` để set flag `dirty` rồi ghi lại file sau mỗi mutation. Đúng nhưng mỗi write = ghi lại cả file. OK cho Phase 0 (~1 row mỗi connect); sẽ cần xem lại khi `scheduled_posts` tích lũy nhiều row ở Phase 1+.
- **Không concurrent thật**. Hai handler Fastify write cùng lúc có thể race trên file write. Hiện tại single-process + write serialize trong thực tế; nếu sau này scale-out phải xét lại.
- **Khởi động WASM chậm** (~50ms) ở lần `openDB()` đầu. Đã giảm bằng lazy `getSQL()` singleton.

### Trung tính
- Mọi SQL đi qua `db.raw.exec(...)` / `db.raw.run(...)` với tham số vị trí. Không có cache prepared statement — fine với row count hiện tại.

## Tham khảo

- [`apps/api/src/db.ts`](../../apps/api/src/db.ts) — wrapper `openDB()`.
- [`packages/shared/src/db/schema.ts`](../../packages/shared/src/db/schema.ts) — schema chạy lúc khởi động.
- [sql.js docs](https://github.com/sql-js/sql.js)
