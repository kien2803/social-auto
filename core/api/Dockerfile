FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy API and shared package configs
COPY core/api/package.json ./core/api/
COPY core/packages/shared/package.json ./core/packages/shared/

# Install dependencies (pnpm hoists workspace packages)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY core/api ./core/api
COPY core/packages/shared ./core/packages/shared

# Build API
WORKDIR /app/core/api
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
