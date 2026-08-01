# API Tests Context

## Purpose

Backend unit, integration, and RAG regression coverage.

## Responsibilities

- Lock deterministic rules, safety boundaries, route contracts, and provider behavior.
- Verify database-backed retrieval/upload behavior with guarded test databases.
- Measure RAG regressions separately from ordinary unit tests.

## Out of Scope

- Production implementation and fixtures containing private workspace data.
- Browser/UI tests.
- Tests that silently use a non-test database.

## Architecture

- `unit/`: isolated or mocked behavior; fast default feedback.
- `integration/`: database/filesystem boundaries and safety guards.
- `rag/`: retrieval and answer-quality evaluation.

## Dependencies

- Internal: API services/routes and workspace packages.
- External: Node test runner through `tsx --test`.
- Provides to: CI/local verification.
- Must never depend on: live private data or production credentials.

## Public APIs

- Root scripts: `test:unit`, `test:integration`, `test:rag`, and `test`.

## Entry Points

- Test globs in root `package.json`.
- `integration/test-database-guard.integration.test.ts` protects database selection.

## Key Files

1. Test matching the service or route being changed.
2. Safety tests for provider/retrieval changes.
3. Integration guard before adding database-backed tests.
4. `rag/rag-evaluation.rag.test.ts` for answer-flow changes.

## Common Tasks

- Add query rule: extend `unit/date-query.test.ts` or `unit/rag-core.test.ts`.
- Change ingestion: update unit quality/frontmatter tests and upload integration test.
- Change provider: update provider and context-caching unit tests.
- Change route: update route unit test and boundary integration test.

## Important Constraints

- Tests must be deterministic and workspace-scoped.
- Network/provider calls require explicit mocks or test adapters.
- Integration tests must fail closed when the database is not marked for tests.
- Add regression coverage before refactoring an orchestration hotspot.

## Related Modules

- Services -> `../src/services/AI_CONTEXT.md`.
- Routes -> `../src/routes/AI_CONTEXT.md`.
- Root verification -> `../../../AI_CONTEXT.md`.

