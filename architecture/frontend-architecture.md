# Frontend Architecture

## Purpose

Describe `apps/web` UI composition.

```mermaid
flowchart TD
  Layout[app/layout.tsx] --> Page[app/[section]/page.tsx]
  Page --> Shell[workspace-shell + workspace-app]
  Shell --> Panels[section panels]
  Panels --> Contexts[workspace/language contexts]
  Panels --> API[Fastify API]
  Panels --> Map[architecture-map.tsx]
```

The Next.js app owns browser state, presentation, uploads, fetch/SSE consumption, and the in-app architecture map. It uses shared contracts but does not own backend business rules.

Related: [request-lifecycle.md](request-lifecycle.md), [system-overview.md](system-overview.md).
