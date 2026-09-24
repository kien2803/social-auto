FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./
COPY core/tsconfig.json ./core/
COPY core/api/tsconfig.json ./core/api/
COPY core/worker/tsconfig.json ./core/worker/
COPY core/web/tsconfig.json ./core/web/

# Copy package configs for workspace
COPY core/api/package.json ./core/api/
COPY core/packages/shared/package.json ./core/packages/shared/
COPY core/worker/package.json ./core/worker/
COPY core/web/package.json ./core/web/

# Install dependencies (including devDeps for tsx build)
RUN pnpm install --frozen-lockfile --include=dev

# Copy source code
COPY core/api ./core/api
COPY core/packages/shared ./core/packages/shared
COPY core/worker ./core/worker
COPY core/web ./core/web

# Build shared first, then compile API TypeScript
RUN cd /app/core/packages/shared && pnpm build
RUN cd /app/core/api && pnpm exec tsc --project tsconfig.prod.json

WORKDIR /app/core/api
EXPOSE 3000

# Start compiled JS directly (no tsx needed)
CMD ["node", "dist/server.js"]
