# Architecture

This directory is the implementation-facing architecture reference. Diagrams describe current code, not intended features. For task navigation, start at [`../AI_CONTEXT.md`](../AI_CONTEXT.md), then read only the relevant document below.

| Change area | Read |
| --- | --- |
| Repository ownership and packages | [system-overview.md](system-overview.md), [dependency-graph.md](dependency-graph.md) |
| API request handling | [request-lifecycle.md](request-lifecycle.md), [backend-architecture.md](backend-architecture.md) |
| Conversion and indexing | [execution-pipeline.md](execution-pipeline.md), [indexing-pipeline.md](indexing-pipeline.md) |
| Search and chat | [retrieval-pipeline.md](retrieval-pipeline.md), [rag-pipeline.md](rag-pipeline.md), [planner-pipeline.md](planner-pipeline.md) |
| Persistence | [database-schema.md](database-schema.md), [data-flow.md](data-flow.md) |
| UI or deployment | [frontend-architecture.md](frontend-architecture.md), [deployment.md](deployment.md) |

## Maintenance

When a route, service boundary, package dependency, schema, provider, or workflow changes, update the affected document and the in-app `/architecture` map in `apps/web/app/architecture-map.tsx` when its view is affected. Run `corepack pnpm docs:check` after changing the shared chat workflow.
