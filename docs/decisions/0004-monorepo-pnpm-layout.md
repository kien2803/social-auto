# ADR-0004: pnpm workspace monorepo (apps/* + packages/*)

## Trạng thái
Đã chấp nhận

## Ngày
2026-08-28

## Bối cảnh

`social-auto` giao 3 đơn vị chạy được, dùng chung types và schema database:

- `apps/api` — backend Fastify.
- `apps/web` — frontend React.
- `apps/worker` — poller scheduled-post (Phase 1+).
- `packages/shared` — types, DB schema, crypto utils, cả ba dùng.

Type "platform X nghĩa là gì", DDL bảng `accounts`, và helper AES phải **giống hệt** giữa API và worker (khi worker cần đọc token). Import chéo hoặc copy-paste sẽ drift.

Đã cân nhắc:

- **3 repo riêng** với git dependency `social-auto-shared`. Đau khi evolve, overhead pinning version.
- **Một repo, không workspace** — mỗi app có bản copy riêng của shared types. Drift chắc chắn xảy ra.
- **pnpm workspaces** — apps và packages ở chung 1 repo, protocol `workspace:*` nối chúng.

## Quyết định

Dùng **pnpm workspaces** với layout:

```
apps/
  api/
  web/
  worker/
packages/
  shared/
```

Khai báo workspace trong `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Import chéo package dùng protocol `workspace:*`:

```json
// apps/api/package.json
"dependencies": {
  "@social-auto/shared": "workspace:*"
}
```

Cấm import chéo giữa các app. Web app không bao giờ import từ `apps/api` và ngược lại.

## Các phương án đã xét

### Turborepo / Nx
- **Ưu**: Cache, task graph, build theo dependency.
- **Nhược**: Thêm tooling, learning curve, file config. Project hiện có 4 package.
- **Loại**: Quá tay với scale hiện tại. Có thể thêm sau mà không cần restructure.

### npm / Yarn workspaces
- **Ưu**: Có sẵn trong package manager.
- **Nhược**: npm workspaces yếu hơn (không có shorthand `workspace:*` first-class cho tới gần đây); Yarn 1 đang trong maintenance.
- **Loại**: pnpm protocol ngắn gọn, store content-addressed tiết kiệm disk là bonus đẹp.

### Một `src/` chung mọi thứ lẫn lộn
- **Ưu**: Đơn giản nhất.
- **Nhược**: Không có ranh giới cưỡng ép giữa đơn vị chạy được và shared code; deploy trở thành all-or-nothing.
- **Loại**: Ép coupling quá sớm.

## Hệ quả

### Tích cực
- Một `pnpm install` ở root cài hết.
- Một `pnpm typecheck` / `pnpm lint` / `pnpm test` chạy qua tất cả package (root script delegate bằng `-r`).
- Shared types update atomic — đổi bảng `accounts` trong `packages/shared`, cả API và worker pick up ở lần typecheck tiếp theo.
- CI build nguyên repo bằng một command.

### Tiêu cực
- **Một package vỡ là vỡ hết**. Nếu `packages/shared` không typecheck, mọi app typecheck fail. Cũng là điểm cốt lõi: drift không tích lũy được.
- **Version Node là của cả repo** (khai báo trong `engines` root). Không hỗ trợ deploy mixed-runtime (không cần).
- **Workspace protocol đòi pnpm** — contributor không dùng được npm hay yarn. Chấp nhận được.

### Trung tính
- Mỗi app có `tsconfig.json` riêng extend root, `package.json` riêng, `vitest.config.ts` riêng. Hơi trùng lặp nhưng giữ mỗi app deploy độc lập được.

## Tham khảo

- Workspace file: [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)
- Root scripts: [`package.json`](../../package.json) — `dev`, `build`, `typecheck`, `lint`, `test`.
- Shared package: [`packages/shared/`](../../packages/shared/)
