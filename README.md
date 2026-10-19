# social-auto

Self-hosted tool to manage and auto-post videos across social platforms — YouTube, TikTok, Instagram, Facebook.

## Features

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
```

## Project Structure

```
social-auto/
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

## License

MIT License - Copyright (c) 2026

## Security

This project follows security best practices:
- OAuth tokens encrypted with AES-256-GCM
- Environment variables for sensitive configuration
- `.gitignore` excludes sensitive files
- Pre-commit hooks to detect secrets

See [SECURITY.md](./SECURITY.md) for detailed security guidelines.
