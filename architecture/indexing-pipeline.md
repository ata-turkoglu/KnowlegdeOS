# Indexing Pipeline

## Purpose

Describe Markdown ingestion and derived search data.

```mermaid
flowchart LR
  Markdown --> Frontmatter[Parse YAML frontmatter]
  Frontmatter --> Normalize[Normalize content]
  Normalize --> Chunks[Create chunks]
  Chunks --> Deterministic[Extract metadata/entities]
  Deterministic --> OptionalLLM[Optional LLM extraction]
  OptionalLLM --> Resolve[Alias, relationships, claims, fields]
  Resolve --> Embed[Embeddings]
  Embed --> DB[(PostgreSQL + pgvector)]
```

Ingestion owns parsing, normalization, and chunking; API services orchestrate workspace-specific persistence and optional enrichment. Preserve original evidence and avoid mutations that erase source wording.

Related: [execution-pipeline.md](execution-pipeline.md), [database-schema.md](database-schema.md).
