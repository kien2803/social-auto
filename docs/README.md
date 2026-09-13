# social-auto — Docs

Engineering docs for `social-auto`, a self-hosted tool to manage and auto-post videos across social platforms (YouTube first, then TikTok, Instagram, Facebook).

## Start here

- **[Architecture](./architecture.md)** — system overview, modules, data flow, OAuth lifecycle.
- **[Features](./features/)** — one file per shipped feature.
- **[Decisions (ADRs)](./decisions/)** — why each architectural choice was made.

## Project plan

Roadmap lives at [`plans/`](../plans/README.md) — four phases:

| Phase | Goal | Status |
|---|---|---|
| 0 — Bootstrap & Credentials | Repo + Google Cloud + OAuth flow | in progress |
| 1 — YouTube MVP | Upload + schedule + auto-post YouTube | pending |
| 2 — Multi-platform | TikTok + IG + FB + YouTube in one UI | pending |
| 3 — Polish | Retry, quota tracking, auto-start | pending |

## Quick start (development)

```bash
# 1. Install
pnpm install

# 2. Copy env template
cp .env.example .env.local
# Edit .env.local: set TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID/SECRET

# 3. Run all apps in parallel (api on :3000, web on :5173)
pnpm dev

# 4. Open the app
# Web:  http://localhost:5173/accounts
# API:  http://localhost:3000/health
```

For tests:

```bash
pnpm typecheck   # type-check everything
pnpm lint        # eslint
pnpm test        # vitest in each workspace package
pnpm test:api    # api tests only
```

## Conventions

- **No external services required for tests.** Set `USE_MOCK_GOOGLE=true` in `.env.local` or leave the Google OAuth fields blank — the API will use a mock Google client. Real Google credentials are only needed when you click **Connect YouTube** in the browser.
- **Phase plans drive development.** Each phase folder under `plans/core/` has a `plan.md` (scope), `tests.md` (acceptance), and `fix-bugs.md` (bug log). Don't ship a phase until all its tests pass.
- **ADR before code for architectural choices.** If a decision is expensive to reverse (framework, schema, auth strategy), write an ADR in `docs/decisions/` first.

## Repo layout

```
apps/
  api/        Fastify + SQLite — OAuth routes, accounts API (Phase 0)
  web/        React + Vite + Tailwind — web UI
  worker/     Node script — scheduled-post poller (Phase 1+)
packages/
  shared/     Types + DB schema + crypto utils shared by all apps
plans/core/    Phase-by-phase roadmap, tests, and bug logs
docs/         You are here
storage/      Local SQLite file and uploaded video files (gitignored)
```

## Contributing

See [`docs/decisions/0004-monorepo-pnpm-layout.md`](./decisions/0004-monorepo-pnpm-layout.md) for the monorepo rationale. New apps go in `apps/`, new shared code goes in `packages/shared/`. Internal cross-app imports must go through `@social-auto/shared`; do not import across `apps/*` directly.
