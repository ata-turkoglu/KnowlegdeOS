# Planner Pipeline

## Purpose

Describe query-analysis decisions that choose execution rather than answer content.

```mermaid
flowchart TD
  Input[User query] --> Normalize[Safe normalization]
  Normalize --> Analyze[Intent, filters, anchors]
  Analyze --> Direct{Structured direct answer?}
  Direct -->|yes| SQL[Scoped SQL aggregation/timeline]
  Direct -->|no| Strategy[Select retrieval lanes]
  Strategy --> Retrieve[Entity, lexical, semantic retrieval]
  SQL --> Result[Evidence-backed result]
  Retrieve --> Result
```

Planning is rule-based orchestration with explicit capability and cost choices. It must not bypass workspace scope, evidence requirements, or downstream citation validation.

Related: [retrieval-pipeline.md](retrieval-pipeline.md), [rag-pipeline.md](rag-pipeline.md).
