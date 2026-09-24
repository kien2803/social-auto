# social-auto

Self-hosted tool to manage and auto-post videos across social platforms — YouTube first, then TikTok, Instagram, Facebook.

> **See [`docs/`](./docs/) for everything: architecture, features, design decisions, and dev setup.**
>
> Quick links: [Architecture](./docs/architecture.md) · [Feature: YouTube OAuth](./docs/features/youtube-oauth.md) · [Decisions (ADRs)](./docs/decisions/) · [Roadmap (`plans/`)](./plans/README.md)

## What works today (Phase 0)

- ✅ Web UI at `http://localhost:5173` (React + Vite + Tailwind)
- ✅ API at `http://localhost:5182` (Fastify + SQLite)
- ✅ Worker polling service for scheduled posts
- ✅ Connect YouTube, TikTok, Instagram, Facebook accounts via OAuth
- ✅ Encrypted token persistence with AES-256-GCM
- ✅ Token refresh and lifecycle management
- ✅ Video upload with SHA256 deduplication
- ✅ Thumbnail generation with ffmpeg
- ✅ Quota tracking and management
- ✅ All tests passing (130+ tests across API, Worker, Web)
- ✅ **Production web app deployed**: https://social-auto-three.vercel.app
- ✅ **Custom domain pending**: kian.is-a.dev (PR #52389 awaiting merge)

## Quick start

```bash
pnpm install
cp .env.example .env.local       # fill in TOKEN_ENCRYPTION_KEY (and Google creds if not using mock)
pnpm dev                          # runs api + web + worker in parallel
```

Access the application:
- **Web UI**: http://localhost:5173
- **API**: http://localhost:5182
- **Health check**: http://localhost:5182/health

For tests, leave `USE_MOCK_GOOGLE=true` in `.env.local` — no Google credentials needed.

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Production Deployment

### Web App (Vercel)
- **URL**: https://social-auto-three.vercel.app
- **Status**: ✅ Deployed and operational
- **Custom Domain**: kian.is-a.dev (pending DNS merge)

### API Backend & Worker
- **Status**: Local development only (currently working on production deployment)
- **Planned**: Simplified deployment strategy (see Phase 1 Production MVP plan)

## Development Guide

### Running locally
```bash
pnpm dev                    # Start API (5182), Web (5173), Worker
pnpm core:dev:api          # API only
pnpm core:dev:web          # Web only  
pnpm core:dev:worker       # Worker only
```

### Testing
```bash
pnpm test                   # Run all tests
pnpm test:api              # API tests only
pnpm typecheck             # TypeScript type checking
pnpm lint                  # ESLint checking
```

### Simulator
```bash
pnpm simulator             # Run multi-platform publishing tests
pnpm simulator:all         # Test all platforms
```

## Repo at a glance

```
core/api                 Fastify backend, OAuth routes, SQLite
core/web                 React + Vite UI  
core/worker              Scheduled-post poller
core/packages/shared    Types, DB schema, AES-256-GCM crypto
apps/simulator         Test harness for multi-platform publishing
docs/                   Architecture, features, ADRs
plans/core/            Phase-by-phase roadmap (plan.md / tests.md / fix-bugs.md per phase)
storage/               SQLite file + uploads (gitignored)
```

## License

Private — not yet licensed for distribution.
