# Retrieval Pipeline

## Purpose

Describe query retrieval before response generation.

```mermaid
flowchart LR
  Query --> Analyze[Normalize and analyze]
  Analyze --> Plan[Execution planner]
  Plan --> Entity[Entity retrieval]
  Plan --> Lexical[Lexical retrieval]
  Plan --> Semantic[Embedding + vector retrieval]
  Entity --> Fuse[RRF/hybrid fusion]
  Lexical --> Fuse
  Semantic --> Fuse
  Fuse --> Rerank[Rerank when required]
  Rerank --> Evidence[Candidate evidence]
```

The planner may select direct database answers for structured questions. Retrieval remains workspace-scoped and returns evidence candidates, not unsupported conclusions.

Related: [planner-pipeline.md](planner-pipeline.md), [rag-pipeline.md](rag-pipeline.md).
