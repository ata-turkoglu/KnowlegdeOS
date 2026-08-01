# Ingestion Package Context

## Purpose

Pure text-processing pipeline for Markdown normalization, frontmatter, chunking, and deterministic extraction.

## Responsibilities

- Normalize text for storage/search without losing source meaning.
- Parse/render Markdown frontmatter.
- Split documents into stable chunks.
- Extract reusable deterministic metadata/entity candidates.

## Out of Scope

- Database writes, workspace paths, provider/model selection, HTTP upload, and job progress.
- LLM orchestration and entity graph persistence.

## Architecture

`normalize.ts` -> `frontmatter.ts` -> `chunk.ts` -> `extract.ts`, exposed by `index.ts`. API services compose these pure functions with storage, models, and persistence.

## Dependencies

- Internal: `@knowledgeos/shared`.
- External: none beyond runtime/TypeScript primitives.
- Provides to: API ingestion, query normalization helpers, and search package.
- Must never depend on: database, AI, apps, or filesystem storage.

## Public APIs

- Normalization, chunking, extraction, and frontmatter helpers exported from `src/index.ts`.

## Entry Points

- `src/index.ts`.

## Key Files

1. `src/index.ts`
2. `src/normalize.ts`
3. `src/frontmatter.ts`
4. `src/chunk.ts`
5. `src/extract.ts`
6. Matching API unit tests

## Common Tasks

- Fix normalization: update `normalize.ts` and retrieval/normalizer regression tests.
- Extend frontmatter: update parser/renderer and `frontmatter.test.ts`.
- Change chunking: update `chunk.ts`, ingestion consumers, and RAG expectations.
- Add deterministic extractor: implement in `extract.ts` and export it.

## Important Constraints

- Preserve Unicode, Turkish characters, dates, codes, numbers, and source uncertainty.
- Never invent or summarize content while normalizing.
- Keep functions deterministic and independently testable.
- Avoid filesystem/database/provider side effects.

## Related Modules

- Persistence/orchestration -> `../../apps/api/src/services/AI_CONTEXT.md`.
- Query classification consumer -> `../search/AI_CONTEXT.md`.
- Ingestion docs -> `../../docs/05-Ingestion-Engine.md`.

