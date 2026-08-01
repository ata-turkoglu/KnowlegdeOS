# Database Schema

## Purpose

Summarize persisted workspace knowledge; `packages/database/src/schema.ts` is authoritative.

```mermaid
erDiagram
  WORKSPACES ||--o{ DOCUMENTS : owns
  WORKSPACES ||--o{ WORKSPACE_FIELDS : defines
  DOCUMENTS ||--o{ DOCUMENT_CHUNKS : contains
  DOCUMENTS ||--o{ DOCUMENT_FIELD_VALUES : has
  DOCUMENTS ||--o{ DOCUMENT_ENTITIES : mentions
  DOCUMENTS ||--o{ CLAIMS : supports
  DOCUMENT_CHUNKS ||--o{ CHUNK_ENTITIES : mentions
  WORKSPACES ||--o{ ENTITIES : canonicalizes
  ENTITIES ||--o{ ENTITY_ALIASES : has
  ENTITIES ||--o{ RELATIONSHIPS : connects
  WORKSPACES ||--o{ CHAT_SESSIONS : owns
  CHAT_SESSIONS ||--o{ CHAT_MESSAGES : contains
```

Every relevant record is workspace-scoped. `documents.metadata` is JSONB for parsed frontmatter; indexed/filterable fields also receive normalized rows. Schema changes require forward-only migrations.

Related: [data-flow.md](data-flow.md), [`../packages/database/AI_CONTEXT.md`](../packages/database/AI_CONTEXT.md).
