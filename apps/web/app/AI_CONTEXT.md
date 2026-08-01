# Web App Context

## Purpose

Next.js App Router pages, workspace shell, feature panels, and client-side API orchestration.

## Responsibilities

- Map URL sections to feature panels.
- Manage workspace/language state and feature-specific requests.
- Render operation and chat progress.
- Keep `/architecture` synchronized with implemented workflows.

## Out of Scope

- Generic reusable controls (`../components/ui`).
- Backend validation/business rules.
- Database or storage access.

## Architecture

- Composition: `layout.tsx` -> page/section route -> `workspace-app.tsx` -> panel.
- Shell: `workspace-shell.tsx`, switcher, navigation, workspace context.
- State: `workspace-context.tsx`, `language-context.tsx`.
- Features: matching `*-panel.tsx` files.
- Progress: `chat-progress-dialog.tsx`, `operation-status-dialog.tsx`.

## Dependencies

- Internal: UI primitives, workspace/language contexts, shared workflow types.
- External: React, Next.js, React Flow for the architecture map.
- Provides to: route-level UI.
- Must never depend on: backend service files.

## Public APIs

- `WorkspaceApp`, `WorkspaceShell`, context hooks, and panel components.
- Next.js route exports from `page.tsx` and `layout.tsx`.

## Entry Points

- `page.tsx`, `[section]/page.tsx`, and `settings/page.tsx`.

## Key Files

1. Matching feature `*-panel.tsx`.
2. `workspace-app.tsx` for section composition.
3. `workspace-context.tsx` for scoped requests.
4. `language-context.tsx` for user-facing copy.
5. `architecture-map.tsx` only when workflow behavior changes.
6. `globals.css` for layout/style changes.

## Common Tasks

- Add section: update route validation, `workspace-app.tsx`, shell navigation, labels.
- Change chat: inspect `chat-panel.tsx`, progress dialog, shared workflow, API chat route.
- Change settings: inspect settings panel and API settings route/config together.
- Change upload/conversion: inspect panel, operation dialog, matching API route.

## Important Constraints

- Client files using hooks/browser APIs require `"use client"`.
- Abort or clean up long-running fetch/SSE operations on unmount.
- Do not infer completed progress stages that were never emitted.
- Keep `/architecture` node, edge, and detail text aligned with behavior.
- Prefer existing UI primitives and CSS tokens.

## Related Modules

- Reusable controls -> `../components/AI_CONTEXT.md`.
- Backend endpoints -> `../../api/src/routes/AI_CONTEXT.md`.
- Workflow contract -> `../../../packages/shared/AI_CONTEXT.md`.

