# KnowledgeOS

Local-first AI-powered archive and knowledge management system.

Project structure, development rules, and canonical process documentation start at [PROJECT.md](PROJECT.md).

AI coding assistants should start at [AI_CONTEXT.md](AI_CONTEXT.md), then follow the nearest subtree context file.

## Sprint 1

This repository is structured as a pnpm monorepo:

- `apps/api` - Fastify API
- `apps/web` - Next.js UI
- `packages/shared` - shared types
- `packages/database` - database layer placeholder
- `packages/ingestion` - ingestion pipeline placeholder
- `packages/search` - query routing/search placeholder
- `packages/ai` - local AI provider interfaces and prompts

## Development

```bash
corepack pnpm install
corepack pnpm dev
```

Copy `.env.example` to `.env` before running services that need configuration.

Provider prompt caching, its privacy boundary, observability, and configuration are
documented in [docs/provider-context-caching.md](docs/provider-context-caching.md).

## Docker

Docker Compose starts PostgreSQL with pgvector, runs database migrations, pulls
the configured Ollama models, and then starts the API and web application:

```bash
docker compose up --build
```

Open `http://localhost:3000`. The API is available at
`http://localhost:4000`, and PostgreSQL is exposed to the host on port `5433`
to avoid conflicting with an existing local installation. The first start can
take a while because Ollama downloads the language and embedding models.

Stop the services while keeping database, model, and uploaded-file data:

```bash
docker compose down
```

To remove all persisted Docker data as well:

```bash
docker compose down --volumes
```

## Database

Create the local PostgreSQL database, then run:

```bash
corepack pnpm --filter @knowledgeos/database db:migrate
```
