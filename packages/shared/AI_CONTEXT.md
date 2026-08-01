# Shared Package Context

## Purpose

Stable contracts shared across backend and frontend, including the canonical chat workflow.

## Responsibilities

- Own types/events that genuinely cross application boundaries.
- Define ordered chat workflow stages used by API progress and web rendering.
- Keep contracts dependency-free.

## Out of Scope

- Business logic, provider calls, database schema, React components, and API implementations.
- Types used by only one module.

## Architecture

- `src/index.ts`: shared public types/barrel.
- `src/chat-workflow.ts`: canonical stage IDs, order, labels, and status helpers.
- Generated workflow documentation is derived from this package by `scripts/generate-chat-workflow-doc.ts`.

## Dependencies

- Internal/external: none at runtime.
- Provides to: API, web, ingestion, and search.
- Must never depend on: any other workspace package or application.

## Public APIs

- Query/result types and chat progress/workflow exports through `src/index.ts`.

## Entry Points

- `src/index.ts`.

## Key Files

1. `src/index.ts`
2. `src/chat-workflow.ts`
3. `../../scripts/generate-chat-workflow-doc.ts`
4. API chat route/service and web progress dialog consumers

## Common Tasks

- Add workflow stage: update canonical stage, API emission, UI display, generate/check docs.
- Add cross-app contract: define minimal serializable type and update both consumers.
- Rename query type: update every consumer and tests; treat as an API change.

## Important Constraints

- Keep the package runtime-light and dependency-free.
- Shared contracts must be serializable and implementation-neutral.
- Do not mark skipped chat stages complete without a real SSE event.
- Run `corepack pnpm docs:generate` after canonical workflow changes.

## Related Modules

- API consumer -> `../../apps/api/AI_CONTEXT.md`.
- Web consumer -> `../../apps/web/AI_CONTEXT.md`.
- Generator -> `../../scripts/AI_CONTEXT.md`.

