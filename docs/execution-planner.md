# Cost-aware Execution Planner

Query processing has four explicit responsibilities:

1. The analyzer context selector chooses at most 20 relevant workspace fields,
   at most 50 entity candidates, and at most 20 normalized metadata values.
2. `query-analyzer.ts` resolves intent, filters, entity IDs, and an optional
   aggregation field.
3. `execution-planner.ts` reads workspace capabilities and estimates filter
   selectivity before producing a validated DAG.
4. Direct and retrieval executors run the allow-listed nodes.

The planner is deterministic. LLM output cannot introduce SQL, arbitrary
operations, unknown fields, cycles, or unbounded limits.

## DAG retrieval

Entity, lexical, and semantic retrieval nodes share the `RETRIEVAL` parallel
group. Fusion depends on all enabled branches:

```text
FILTER
  ├─ ENTITY_LOOKUP ─┐
  ├─ LEXICAL_SEARCH ├─ RRF ─ RERANK ─ ANSWER
  └─ SEMANTIC_SEARCH┘
```

Semantic search is disabled when no compatible workspace embedding index is
available. RRF is omitted for a single retrieval branch. Rerank is omitted for
small, highly selective candidate sets.

## Direct execution

`COUNT`, `EXISTS`, `TIMELINE`, `DISTINCT`, `GROUP_BY`, and `FACET` use typed
database values and do not call the answer model.

## Estimates and telemetry

Plans expose indexed document count, filtered document count, selectivity,
expected rows, selected capabilities, and estimated cost. Executions record
per-node row counts and durations. A privacy-preserving record is persisted in
`query_executions` using a query hash rather than the raw query.

## Chunk reuse

`document_chunks.content_hash` and `embedding_model` allow unchanged chunks to
reuse embeddings after reindexing and across documents. Responses from the
embedding job report reused and newly generated chunk counts.
