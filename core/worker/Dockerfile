FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install pnpm
RUN npm install -g pnpm@9.0.0

# Copy workspace package files
COPY core/worker/package.json ./core/worker/
COPY core/packages/shared/package.json ./core/packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY core/worker ./core/worker
COPY core/packages/shared ./core/packages/shared

# Build the application
WORKDIR /app/core/worker
RUN pnpm build

# Start the worker
CMD ["node", "--import", "tsx", "src/index.ts"]
