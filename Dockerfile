FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PNPM_STORE_DIR="/pnpm/store"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends pandoc && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ingestion/package.json packages/ingestion/package.json
COPY packages/search/package.json packages/search/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN corepack pnpm fetch --frozen-lockfile

COPY apps apps
COPY packages packages

RUN corepack pnpm install --frozen-lockfile --offline

COPY . .

CMD ["corepack", "pnpm", "dev"]
