# Request Lifecycle

## Purpose

Describe an API request from browser action to response.

```mermaid
sequenceDiagram
  participant UI as Next.js UI
  participant Route as Fastify route
  participant Service as API service
  participant Pkg as Package/provider
  participant Store as DB or workspace storage
  UI->>Route: HTTP request or upload
  Route->>Route: validate input and workspace scope
  Route->>Service: typed orchestration call
  Service->>Pkg: reusable pipeline capability
  Service->>Store: read/write scoped state
  Service-->>Route: result or domain error
  Route-->>UI: JSON, file, or SSE progress
```

Routes are transport adapters; durable domain behavior belongs in services. Chat operations additionally stream progress events and only persist validated output.

Related: [backend-architecture.md](backend-architecture.md), [rag-pipeline.md](rag-pipeline.md).
