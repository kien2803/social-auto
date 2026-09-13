# Plans Index

Project roadmap cho `social-auto` — tool quản lý & auto-post video đa nền tảng (YouTube, TikTok, Instagram, Facebook).

## Phases

| Phase | Tên | Goal | Estimate | Status |
|---|---|---|---|---|
| [0](./core/phase-0-bootstrap/) | Bootstrap & Credentials | Repo + Google Cloud + OAuth flow | M (1-2 days) | done |
| [1](./core/phase-1-youtube-mvp/) | YouTube MVP | Upload + schedule + auto-post YouTube | L (4-6 days) | done (simulator --all pass 2026-08-29) |
| [2](./core/phase-2-multi-platform/) | Multi-platform | TikTok + IG + FB + YouTube cùng UI | L (5-8 days) | done (simulator --all 7/7 pass 2026-08-31) |
| [3](./core/phase-3-polish/) | Polish | Retry, quota tracking, auto-start | M (2-3 days) | done (2026-09-04) |

- **`plan.md`** — mục tiêu, tasks, contracts, risks, acceptance.
- **`tests.md`** — test cases (unit, integration, e2e, manual) — phải pass trước khi qua phase sau.
- **`fix-bugs.md`** — log bugs gặp phải, root cause, fix, verification.

## Workflow khi làm 1 phase

1. Đọc `plan.md`, confirm scope.
2. Implement tasks theo thứ tự.
3. Chạy tests trong `tests.md`. Mỗi fail → investigate → fix → log vào `fix-bugs.md`.
4. Phase đó 100% tests pass + acceptance check pass → mới sang phase sau.

## Khi tìm thấy bug

Thêm entry vào `fix-bugs.md` của phase hiện tại theo format:

```
## BUG-XXX: <title>
- Discovered: ...
- Symptom: ...
- Root cause: ...
- Fix: <file:symbol>
- Verification: ...
- Status: open | fixed | wontfix
```

## Stack tổng quan

- **Backend**: Node.js + Fastify + TypeScript
- **Frontend**: React + Vite + Tailwind
- **DB**: SQLite (Drizzle ORM)
- **Storage**: local filesystem
- **Worker**: Node script polling (hoặc BullMQ + Redis nếu cần queue)
- **Scheduler**: in-process (node-cron / setInterval)
- **Auto-start**: pm2 hoặc node-windows