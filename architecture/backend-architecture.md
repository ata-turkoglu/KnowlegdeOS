# Backend Architecture

## Purpose

Describe `apps/api` boundaries.

```mermaid
flowchart LR
  Index[src/index.ts] --> Routes[src/routes]
  Routes --> Services[src/services]
  Services --> Providers[packages/ai]
  Services --> Search[packages/search]
  Services --> Ingestion[packages/ingestion]
  Services --> Database[packages/database]
  Services --> Storage[workspace storage]
```

`src/index.ts` registers health, settings, dashboard, workspace, document, conversion, entity, search, and chat routes. Services coordinate cancellation, provider selection, persistence, retrieval, and evidence rules. Reusable algorithms stay in packages.

Related: [request-lifecycle.md](request-lifecycle.md), [planner-pipeline.md](planner-pipeline.md).
