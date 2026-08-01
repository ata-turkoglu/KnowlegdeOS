# Deployment Overview

## Purpose

Describe the supported local Docker topology.

```mermaid
flowchart LR
  Browser --> Web[web :3000]
  Web --> API[api :4000]
  API --> PG[postgres :5432 internal]
  API --> Ollama[ollama :11434]
  Migrate[migrate job] --> PG
  Models[ollama-models job] --> Ollama
```

`compose.yaml` starts PostgreSQL/pgvector, runs migrations, prepares configured Ollama models, then starts API and web containers. Persistent volumes retain PostgreSQL and Ollama state; workspace and converted Markdown mounts preserve local archive data.

Related: [external-integrations.md](external-integrations.md), [system-overview.md](system-overview.md).
