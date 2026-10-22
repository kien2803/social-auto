# Social-Media-Account-Management

Self-hosted tool to manage and auto-post videos across social platforms — YouTube, TikTok, Instagram, Facebook.

## Features

- 👤 Multi-user authentication (register/login, JWT, per-user data isolation)
- 🎬 Upload and manage videos
- 🔗 Connect social accounts via OAuth (YouTube, TikTok, Instagram, Facebook)
- 📅 Schedule posts with automatic publishing
- 🔒 Encrypted token storage (AES-256-GCM)
- 🔄 Automatic token refresh
- 💾 Quota tracking and storage management
- 🎨 Thumbnail generation with ffmpeg
- 🧪 Full test coverage (234 tests)

## Tech Stack

- **Backend**: Fastify + SQLite
- **Frontend**: React + Vite + Tailwind CSS
- **Worker**: Background job scheduler
- **Package Manager**: pnpm workspaces
- **Language**: TypeScript

## Quick Start

```bash
# Install dependencies
pnpm install

# Setup environment
cp .env.example .env.local
# Edit .env.local: Set TOKEN_ENCRYPTION_KEY (required)
# For testing: keep USE_MOCK_GOOGLE=true (no credentials needed)
# For production: Set USE_MOCK_GOOGLE=false and add Google OAuth credentials

# Start development
pnpm dev
```

Access the application:
- **Web UI**: http://localhost:5173
- **API**: http://localhost:3000
- **Health check**: http://localhost:3000/health

## Common Commands

### Development
```bash
pnpm dev                    # Start API + Web + Worker
pnpm core:dev:api          # API only
pnpm core:dev:web          # Web only
pnpm core:dev:worker       # Worker only
```

### Testing & Quality
```bash
pnpm test                   # Run all tests
pnpm test:api              # API tests only
pnpm typecheck             # TypeScript type checking
pnpm lint                  # ESLint checking
```

### Build
```bash
pnpm core:build            # Build all core packages
pnpm build                 # Build the web bundle only (production artifact)
```

## Production / Self-Hosted

### Docker (recommended)

One container runs everything — the API serves the built SPA and the
publishing worker runs embedded in the same process (single DB writer, no
cross-process file race).

```bash
# 1. Create .env with at least the two secrets (generate with:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
TOKEN_ENCRYPTION_KEY=...
JWT_SECRET=...
WEB_ORIGIN=http://localhost:3000   # public origin users open

# 2. Build & run
docker compose up -d --build
# or without compose:
#   docker build -t social-auto .
#   docker run -d -p 3000:3000 -v social-auto-data:/app/storage \
#     --env-file .env social-auto
```

Open http://localhost:3000 — the landing page, app, API, and OAuth
callbacks all live on the one port. SQLite DB + uploads persist in the
`social-auto-data` volume (host path `./storage` works too:
`-v ./storage:/app/storage`).

### Bare metal / VM

```bash
pnpm install
pnpm build                        # produces core/web/dist
EMBEDDED_WORKER=true pnpm start   # API + web + worker on :3000
```

Requirements: Node.js >= 22, pnpm 9, ffmpeg + ffprobe on PATH.
`EMBEDDED_WORKER=true` is recommended for single-machine deploys; to scale
the worker separately instead, run `pnpm -F @social-auto/api start` and
`pnpm -F @social-auto/worker start` as two processes (note: both write to
the same SQLite file — embedded mode avoids that race entirely).

### Production checklist

- Set `WEB_ORIGIN` to the public URL (also used for OAuth `redirect_uri`)
- Set `*_REDIRECT_URI` values to `${WEB_ORIGIN}/auth/...` and register
  them in each platform's developer console
- Flip `USE_MOCK_*=false` and fill real credentials (see
  [API_CREDENTIALS_GUIDE.md](./API_CREDENTIALS_GUIDE.md))
- Put HTTPS in front (reverse proxy) before exposing publicly

## Project Structure

```
Social-Media-Account-Management/
├── core/
│   ├── api/              # Fastify backend, OAuth routes, SQLite
│   ├── web/              # React + Vite UI
│   ├── worker/           # Scheduled-post poller
│   └── packages/
│       └── shared/       # Types, DB schema, crypto utilities
└── storage/              # SQLite database + uploads (gitignored)
```

## Environment Variables

Required variables in `.env.local`:

```bash
# Required for all modes
TOKEN_ENCRYPTION_KEY=your-32-byte-hex-key
JWT_SECRET=your-jwt-secret

# Mock mode (for testing - no credentials needed)
USE_MOCK_GOOGLE=true
USE_MOCK_PUBLISHERS=true

# Production mode (requires Google OAuth credentials)
USE_MOCK_GOOGLE=false
USE_MOCK_PUBLISHERS=false
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

See [`.env.example`](./.env.example) for full configuration options.

## API Credentials

The app currently runs in **mock mode** (no real credentials needed). To use real social media platforms, see [API_CREDENTIALS_GUIDE.md](./API_CREDENTIALS_GUIDE.md) for setup instructions for:
- YouTube (Google OAuth)
- TikTok
- Facebook & Instagram (Meta)

## License

MIT License - Copyright (c) 2026

## Security

This project follows security best practices:
- OAuth tokens encrypted with AES-256-GCM
- Environment variables for sensitive configuration
- `.gitignore` excludes sensitive files
- Pre-commit hooks to detect secrets
