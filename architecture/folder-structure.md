# Folder Structure

## Purpose

Map repository ownership without duplicating module context files.

```text
apps/
  api/        Fastify routes and application orchestration
  web/        Next.js UI
packages/
  ai/         provider adapters and prompts
  database/   Drizzle schema, client, migrations
  ingestion/  Markdown parsing, normalization, chunking
  search/     retrieval primitives
  shared/     cross-app contracts and workflow stages
architecture/ implementation-facing diagrams
docs/         product and operational documentation
scripts/      repository generators
storage/      runtime workspace data; not source code
```

For implementation details read the closest `AI_CONTEXT.md`: `apps/api`, `apps/web`, or the relevant `packages/*` subtree. Apps may consume packages; packages must not import apps.

Related: [dependency-graph.md](dependency-graph.md), [`../AI_CONTEXT.md`](../AI_CONTEXT.md).
