# Search Package Context

## Purpose

Reusable query classification and routing primitives independent of storage and providers.

## Responsibilities

- Classify user query shape into shared query types.
- Provide deterministic search-domain helpers suitable for multiple consumers.

## Out of Scope

- SQL, embeddings, entity lookup, RRF, reranking, and chat orchestration.
- Workspace/document scoping and model calls.

## Architecture

The package is intentionally small. `src/index.ts` owns its public classification behavior; application retrieval lives in API services.

## Dependencies

- Internal: ingestion normalization and shared query types.
- External: none.
- Provides to: API query analyzer and potential future clients.
- Must never depend on: database, AI, or apps.

## Public APIs

- `classifyQuery` and related exported search types/helpers in `src/index.ts`.

## Entry Points

- `src/index.ts`.

## Key Files

1. `src/index.ts`
2. `../shared/src/index.ts` for query types
3. API `query-analyzer.ts` consumer

## Common Tasks

- Add query class: update shared type if cross-app, classifier, analyzer, planner, and tests.
- Improve deterministic matching: update classifier patterns and regression tests.
- Add retrieval algorithm: do not put it here unless it is storage/provider independent; usually use API services.

## Important Constraints

- Classification must be deterministic, bounded, and language-aware.
- Preserve backward compatibility of shared query labels.
- Avoid database/provider dependencies and application state.

## Related Modules

- Analyzer/planner -> `../../apps/api/src/services/AI_CONTEXT.md`.
- Normalization -> `../ingestion/AI_CONTEXT.md`.
- Shared types -> `../shared/AI_CONTEXT.md`.

