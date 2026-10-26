# syntax=docker/dockerfile:1
#
# Single-image build: React SPA is compiled in the builder stage, then the
# runtime stage serves it directly from the Fastify API (single origin).
# EMBEDDED_WORKER=true runs the publisher in the same process, so one
# container = web + API + worker with a single sql.js writer (no
# cross-process DB race).

# ---------- build ----------
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Workspace manifests first for install-layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY core ./core

RUN pnpm install --frozen-lockfile
# web's tsconfig project-references @social-auto/shared (composite) — its
# dist/*.d.ts must exist before tsc runs; .dockerignore excludes dist so
# it can never come from the build context.
RUN pnpm -F @social-auto/shared run build \
 && pnpm -F @social-auto/web run build

# ---------- runtime ----------
# Node >= 22 required: Promise.withResolvers (Node 20 is EOL anyway).
FROM node:22-alpine AS runtime
# ffmpeg/ffprobe are required for duration probing + thumbnails.
RUN apk add --no-cache ffmpeg libxcb \
 && corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
ENV NODE_ENV=production \
    EMBEDDED_WORKER=true \
    API_HOST=0.0.0.0 \
    API_PORT=3000

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY core ./core
COPY --from=build /app/core/web/dist ./core/web/dist

# Production deps only (tsx is a runtime dep — @social-auto/shared exports
# TypeScript source, so the server entry runs through tsx, not node).
RUN pnpm install --frozen-lockfile --prod

# SQLite DB + uploaded videos live here; mount a volume to persist them.
VOLUME /app/storage
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["pnpm", "--filter", "@social-auto/api", "run", "start"]
