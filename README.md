# social-auto

Self-hosted tool to manage and auto-post videos across social platforms — YouTube first, then TikTok, Instagram, Facebook.

> **See [`docs/`](./docs/) for everything: architecture, features, design decisions, and dev setup.**
>
> Quick links: [Architecture](./docs/architecture.md) · [Feature: YouTube OAuth](./docs/features/youtube-oauth.md) · [Decisions (ADRs)](./docs/decisions/) · [Roadmap (`plans/`)](./plans/README.md)

## What works today (Phase 0)

- Web UI at `http://localhost:5173`
- API at `http://localhost:3000`
- Connect a YouTube account via Google OAuth and persist the refresh token encrypted
- `/auth/youtube/status` verifies the token is still good
- Survives server restarts

## Quick start

```bash
pnpm install
cp .env.example .env.local       # fill in TOKEN_ENCRYPTION_KEY (and Google creds if not using mock)
pnpm dev                          # runs api + web in parallel
```

For tests, leave `USE_MOCK_GOOGLE=true` in `.env.local` — no Google credentials needed.

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Repo at a glance

```
apps/api          Fastify backend, OAuth routes, SQLite
apps/web          React + Vite UI
apps/worker       Scheduled-post poller (Phase 1+)
packages/shared   Types, DB schema, AES-256-GCM crypto
docs/             Architecture, features, ADRs
plans/core/    Phase-by-phase roadmap (plan.md / tests.md / fix-bugs.md per phase)
storage/          SQLite file + uploads (gitignored)
```

## License

Private — not yet licensed for distribution.
