# API Routes Context

## Purpose

HTTP/SSE transport boundary for the Fastify application.

## Responsibilities

- Declare endpoint methods and paths.
- Validate bodies, params, queries, files, limits, and allowed fields.
- Translate service results/errors into HTTP or SSE responses.
- Register routes through exported `register*Routes` functions.

## Out of Scope

- SQL, retrieval algorithms, prompt construction, and filesystem workflows.
- Long-lived business rules or provider selection logic.
- Frontend behavior.

## Architecture

Each file owns one API area and calls same-domain services. `src/index.ts` is the only route-registration composition root.

## Dependencies

- Internal: `../services/*`, `../config/env.ts`, shared types when required.
- External: Fastify types and multipart primitives.
- Provides to: web panels and local clients.
- Must never depend on: other route files for business behavior.
- Forbidden imports: database schema/client modules except a narrowly justified transport health check.

## Public APIs

- `registerChatRoutes`, `registerConversionRoutes`, `registerDashboardRoutes`.
- `registerDocumentRoutes`, `registerEntityRoutes`, `registerHealthRoutes`.
- `registerSearchRoutes`, `registerSettingsRoutes`, `registerWorkspaceRoutes`.

## Entry Points

- `../index.ts` imports and invokes every registration function.

## Key Files

1. Matching route for the endpoint under change.
2. The services imported by that route.
3. `../index.ts` only when adding/removing a route group.
4. `../../test/unit/chat-routes.test.ts` for transport patterns.

## Common Tasks

- Add an endpoint: extend the matching file, validate input, call a service.
- Add SSE progress: keep stage IDs aligned with `@knowledgeos/shared`.
- Add upload field: update validation, service contract, UI caller, and safety tests.
- Change error response: reuse `../lib/http-errors.ts` conventions.

## Important Constraints

- Reject unknown or malformed input at the boundary.
- Do not expose stack traces, secrets, storage paths, or raw provider errors.
- Preserve streaming cleanup and client-disconnect behavior.
- Route names and response contracts are public application APIs.

## Related Modules

- Business implementation -> `../services/AI_CONTEXT.md`.
- Frontend callers -> `../../../web/app/AI_CONTEXT.md`.
- Shared contracts -> `../../../../packages/shared/AI_CONTEXT.md`.

