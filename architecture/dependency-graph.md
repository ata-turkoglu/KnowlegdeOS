# Module Dependency Graph

## Purpose

Show allowed internal dependency direction.

```mermaid
flowchart TD
  Web[apps/web] --> Shared[packages/shared]
  API[apps/api] --> AI[packages/ai]
  API --> DB[packages/database]
  API --> Ingest[packages/ingestion]
  API --> Search[packages/search]
  API --> Shared
  Search --> Ingest
  Search --> Shared
  Ingest --> Shared
```

`packages/ai`, `packages/database`, and `packages/shared` have no internal-package dependencies. `packages/search` consumes ingestion and shared contracts. Do not create app-to-app or package-to-app imports.

Related: [backend-architecture.md](backend-architecture.md), [frontend-architecture.md](frontend-architecture.md).
