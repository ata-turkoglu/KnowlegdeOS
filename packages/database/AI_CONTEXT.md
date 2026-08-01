# Database Package Context

## Purpose

Canonical PostgreSQL/pgvector schema, database client factory, and forward-only migrations.

## Responsibilities

- Define Drizzle tables, columns, indexes, relations, and exported schema types.
- Create database/query clients and run migrations.
- Preserve migration history.

## Out of Scope

- Domain query orchestration, HTTP behavior, filesystem storage, and UI.
- Automatic production data repair outside explicit migrations/operations.

## Architecture

- `src/schema.ts`: current schema model.
- `src/client.ts`: database client construction.
- `src/migrate.ts`: migration runner.
- `drizzle/*.sql`: immutable ordered migrations; `meta/_journal.json` tracks order.

## Dependencies

- Internal: none.
- External: Drizzle ORM, postgres.js, dotenv for migration execution.
- Provides to: API services.
- Must never depend on: apps, AI, ingestion, search, or shared packages.

## Public APIs

- Tables, enums, schema types, and `createDatabaseClient` through `src/index.ts`.

## Entry Points

- Public import: `src/index.ts`.
- Migration command: `src/migrate.ts` via `db:migrate`.

## Key Files

1. `src/schema.ts`
2. `src/index.ts`
3. Latest migration(s) in `drizzle/`
4. `drizzle/meta/_journal.json`
5. API services that query the affected tables

## Common Tasks

- Add table/column/index: update schema, create a new migration, update journal through tooling.
- Change query performance: inspect existing indexes and retrieval SQL consumers.
- Add exported type: update schema and barrel export.

## Important Constraints

- Never edit an existing migration after it may have run.
- Every persistent record must preserve workspace ownership where applicable.
- Embedding dimension/model assumptions must stay aligned with indexing/search.
- Use parameterized queries; never build SQL from untrusted strings.
- Close clients created for bounded operations.

## Related Modules

- Query consumers -> `../../apps/api/src/services/AI_CONTEXT.md`.
- Architecture docs -> `../../docs/04-Database.md`.
- Package rules -> `../AI_CONTEXT.md`.

