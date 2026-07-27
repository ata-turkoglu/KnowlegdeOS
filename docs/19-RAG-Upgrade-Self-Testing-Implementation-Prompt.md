# KnowledgeOS RAG Upgrade — Self-Testing Implementation Prompt

Act as a senior TypeScript/PostgreSQL engineer working directly in this repository. Implement the changes, migrations, tests, fixtures, evaluation tools, and documentation. Do not stop at analysis. Preserve user changes in the dirty worktree, avoid unrelated edits, never delete user data, and do not use `git reset` or `git checkout --`.

## Context

- pnpm monorepo
- Fastify + TypeScript API
- PostgreSQL 17 + pgvector + Drizzle
- 1024-dimensional embeddings, default model `bge-m3`
- Ollama, OpenAI, and Gemini providers
- Turkish OCR/Markdown archive documents
- Retrieval: entity/alias, semantic, lexical, and hybrid
- `relationships.origin`: `RULE` means co-occurrence; `LLM` means extracted semantic relation

Inspect the call graph starting with:

- `apps/api/src/services/chat.ts`
- `apps/api/src/services/hybrid-search.ts`
- `apps/api/src/services/semantic-search.ts`
- `apps/api/src/services/search.ts`
- `apps/api/src/services/entities.ts`
- `apps/api/src/services/workspace-settings.ts`
- `packages/search/src/index.ts`
- `packages/ingestion/src/chunk.ts`
- `packages/database/src/schema.ts`
- chat/search routes

Verify each suspected issue before changing it:

1. Query classification labels requests but chat still always runs hybrid search.
2. Entity and semantic retrieval run sequentially.
3. Lexical retrieval loads every workspace chunk into Node.js.
4. Semantic context fetch loads all workspace chunks, then filters in memory.
5. Entity lookup loads a large index and risks N+1 queries.
6. Entity evidence may not reach the final LLM context.
7. `[n]` citations are not validated.
8. No repeatable retrieval/latency evaluation exists.
9. Document metadata is stored but not fully used for retrieval filters.
10. `RULE` relationships are noisy co-occurrence signals, not factual relations.

## Target flow

```text
Query
→ input checks and deterministic entity/metadata extraction
→ real query router
   ├─ ENTITY_SEARCH: SQL entity + alias + document evidence
   ├─ SEMANTIC_SEARCH: pgvector + SQL lexical search
   └─ HYBRID_SEARCH: entity + semantic + lexical in parallel
→ metadata filters
→ Reciprocal Rank Fusion
→ optional reranker
→ neighbor/parent context expansion
→ context budgeting with stable source IDs
→ LLM
→ citation/grounding validation
→ answer, sources, and metrics
```

## 1. Build the test and evaluation foundation first

Use Node's test runner with `tsx --test` unless another dependency is clearly justified. Add:

- `pnpm test`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:rag`
- `pnpm verify`

Integration tests must use only `TEST_DATABASE_URL`. Refuse to mutate a database unless its name ends in `_test` or it is explicitly marked as a test database. Never touch development or production data.

Create small, synthetic Turkish archive fixtures covering:

- person/document match
- alias match
- parcel number
- date and document-type filters
- semantic summary
- document comparison
- unanswerable query
- prompt injection inside a document
- identical entity names in separate workspaces

Use a versioned evaluation format:

```ts
type RagEvaluationCase = {
  id: string;
  workspaceSlug: string;
  query: string;
  expectedQueryType: "ENTITY_SEARCH" | "SEMANTIC_SEARCH" | "HYBRID_SEARCH";
  expectedDocumentNames: string[];
  expectedEvidenceTerms?: string[];
  expectedMetadataFilters?: Record<string, string | string[]>;
  answerable: boolean;
};
```

Generate a JSON report with:

- Recall@1/3/5
- Mean Reciprocal Rank
- citation-index validity
- unanswerable-query refusal accuracy
- router accuracy
- retrieval P50/P95 latency
- workspace isolation

Fail `test:rag` below these fixture thresholds:

- citation-index validity: 100%
- workspace isolation: 100%
- refusal accuracy: 90%
- Recall@5: 90%
- router accuracy: 90%

## 2. Move retrieval into PostgreSQL

Remove code that loads all workspace chunks/entities into Node.js.

- Implement lexical retrieval in PostgreSQL using parameterized full-text/trigram queries. Preserve Turkish names, dates, parcel numbers, and case numbers; prefer a suitable `simple` text-search strategy.
- Add non-destructive Drizzle migrations and indexes.
- Fetch semantic context only by selected `chunkId` or another stable key.
- Query entities, aliases, documents, and evidence directly in SQL without N+1 calls.
- Require `workspace_id` in every retrieval query.
- Return stable fields: `documentId`, `chunkId`, `chunkIndex`, `sourceType`, `score`, and `evidenceSnippet`.

## 3. Implement real routing and parallel retrieval

Make `classifyQuery` control execution:

- `ENTITY_SEARCH`: entity/alias plus exact lexical evidence when needed
- `SEMANTIC_SEARCH`: semantic + lexical
- `HYBRID_SEARCH`: entity + semantic + lexical

Run independent retrievers in parallel. One retriever failure must be observable and allow safe partial results. Do not call the LLM when no usable source exists.

Add deterministic router tests for person, date, parcel, “which documents,” summary, comparison, and compound questions.

## 4. Fuse ranks correctly

Do not compare raw scores from different retrievers. Implement Reciprocal Rank Fusion, or document an equivalent method, as a pure tested function.

- prioritize exact entity/alias and metadata matches
- deduplicate documents/chunks
- preserve all contributing retriever types
- use typed, configurable fusion constants
- guarantee deterministic ordering

## 5. Add metadata filters

Use `documents.document_type`, `documents.document_date`, and `documents.metadata`.

Support deterministic extraction of:

- exact year/date
- document type
- explicit YAML metadata fields
- workspace

Apply filters consistently to entity, lexical, and semantic retrieval. Do not use an LLM by default or alter names, dates, parcel numbers, or case/notary numbers.

## 6. Create a testable Context Builder

Centralize context construction:

- include entity evidence
- deduplicate semantic/lexical/entity results
- assign stable citation IDs
- enforce configurable total and per-source budgets
- prevent one chunk from consuming the whole budget
- clearly isolate source data from system instructions
- treat instructions inside documents as untrusted data

Before a full parent-child migration, implement budget-aware neighbor expansion using adjacent chunks from the same document and compatible headings.

## 7. Add a reranker abstraction

```ts
interface Reranker {
  rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    topK: number;
  }): Promise<RetrievalCandidate[]>;
}
```

Requirements:

- no external service required by default
- `NoopReranker` or local baseline
- external providers behind feature flags
- timeout/error fallback to fused ranking
- configurable 20–40 candidates and 5–8 final results
- mock-based ranking tests

Do not add a fake Cohere/BGE integration. If runtime support is unavailable, deliver the interface, fallback, settings, and test double, then document the missing provider.

## 8. Validate citations and answers

Implement a pure validator for `[1]`, `[2]`, etc. Check:

- every citation maps to an existing context source
- answerable factual answers contain citations
- unanswerable queries do not receive unsupported confident answers
- no out-of-range citation exists
- the answer is non-empty and substantive

On validation failure:

1. Retry once with validation errors added to the prompt.
2. If invalid again, return a safe “No source-grounded answer could be produced” result.
3. Do not persist an invalid response as successful.
4. Persist validation metadata without sensitive source text.

Test valid citations, missing citations, `[99]`, document prompt injection, insufficient sources, successful retry, and safe final failure. Optional LLM-as-judge validation must be feature-flagged and unnecessary for tests.

## 9. Add lightweight observability

Record structured metrics per chat request:

- query type and metadata filters
- candidate count and duration per retriever
- fusion/reranker/context/LLM durations
- context count and approximate size
- citation-validation result
- total duration

Do not log document content, secrets, or API keys. Use typed structured logging/timing before adding a heavy observability platform.

## 10. Add controlled query rewriting

Keep rewriting/decomposition behind a feature flag and use it only after weak retrieval.

- always preserve the original query
- lock names, dates, and parcel/case/notary numbers
- skip rewriting when initial retrieval is sufficient
- reject rewrites that change locked values
- fuse original and rewritten results
- keep HyDE disabled by default
- use mocks in tests

## 11. Add a safe cache abstraction

Implement exact caching first; keep semantic caching disabled by default. The key must include:

```text
workspaceId + normalizedQuery + indexVersion
+ retrievalSettingsVersion + provider/model + metadataFilters
```

Invalidate a workspace cache after reindexing. Test hit, miss, invalidation, and cross-workspace isolation. Redis must remain optional; provide an in-memory implementation for tests.

## 12. Relationship policy

Do not enable relationships as a primary retrieval signal yet.

- Treat `RULE` as low-confidence co-occurrence only.
- Never infer ownership, kinship, transfer, or legal facts from `RULE`.
- Require evidence for `LLM` relations.
- Keep graph expansion behind a feature flag with low fusion weight.
- Preserve source document and evidence for graph-derived candidates.

Before enabling graph retrieval, generate a quality report:

- counts by relation/origin/confidence
- highest-degree entities
- likely OCR person errors
- relationship explosions per document

## Safety and compatibility

- No full-workspace chunk/entity reads in application memory.
- Parameterize dynamic SQL and require workspace scope.
- Tests must not require internet or a real LLM.
- LLM/embedding/reranker providers must support test doubles.
- Preserve AbortSignal/timeout behavior.
- Keep API responses backward-compatible where practical.
- Add optional/versioned fields when needed.
- Never delete user files, workspaces, Docker volumes, or existing data.

## Required verification

Run:

```text
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm test:rag
corepack pnpm verify
```

`test:integration` must safely skip or fail with a clear message when `TEST_DATABASE_URL` is absent. In CI, `verify` must run integration tests when a test database is available.

## Definition of done

Do not claim completion unless:

1. Unit, integration, and RAG evaluation tests pass.
2. Typecheck and build pass.
3. Existing chat/search APIs still work.
4. No test mutates development/production data.
5. No retrieval path loads all workspace rows into Node.js.
6. The router executes distinct retrieval plans.
7. Entity evidence reaches LLM context.
8. Citation validation and workspace isolation are tested.
9. Evaluation reports are repeatable.
10. New settings and feature flags are documented.

Work incrementally: inspect → baseline tests → test-DB guard → SQL retrieval → routing/parallelism → fusion/context → metadata → citation validation → metrics → optional interfaces → full verification. Run narrow tests after each phase. Do not hide failures, skip required tests, or lower thresholds to manufacture success.

## Final report

Report:

- main files and migrations changed
- final retrieval flow
- tests added
- evaluation metrics and P50/P95 latency
- citation-validation results
- commands run and their status
- features left disabled or behind flags
- known risks and the next recommended step

Never present untested work as complete. If an external runtime is unavailable, provide a working abstraction, safe fallback, and test double, and state what remains unintegrated.
