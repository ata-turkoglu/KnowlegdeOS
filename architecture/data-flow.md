# Data Flow

## Purpose

Show authoritative locations for source, working, and derived data.

```mermaid
flowchart TD
  Original[Original scan/document] --> Storage[storage/workspaces/<slug>/originals]
  Markdown[Markdown + YAML] --> StorageMD[storage/workspaces/<slug>/markdown]
  StorageMD --> Frontmatter[Frontmatter parser]
  Frontmatter --> Documents[(documents.metadata + content)]
  Documents --> Chunks[(chunks, field values, entities, claims)]
  Chunks --> Vectors[(pgvector embeddings)]
  Vectors --> Retrieval[Search and RAG]
```

Workspace files preserve portable source material. PostgreSQL contains derived query state. YAML scalar/list shape is preserved by the frontmatter parser and stored in `documents.metadata` as JSONB.

Related: [database-schema.md](database-schema.md), [indexing-pipeline.md](indexing-pipeline.md).
