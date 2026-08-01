# Web Components Context

## Purpose

Reusable, application-neutral UI primitives used by feature panels.

## Responsibilities

- Wrap consistent buttons, dialogs, inputs, tables, tabs, icons, and provider setup.
- Centralize shared class naming, accessibility behavior, and PrimeReact adaptation.

## Out of Scope

- Workspace requests, feature state, domain validation, or page routing.
- Backend contracts.

## Architecture

Components live under `ui/` and are exported through `ui/index.ts`. `a-ui-provider.tsx` owns shared provider setup; `ui-classes.ts` owns common class composition.

## Dependencies

- Internal: sibling UI primitives only.
- External: React and PrimeReact where wrapped.
- Provides to: `apps/web/app` panels and dialogs.
- Must never depend on: feature panels, workspace context, API routes, or backend packages.

## Public APIs

- Named exports from `ui/index.ts`.

## Entry Points

- Consumers import from `components/ui` through the barrel export.

## Key Files

1. `ui/index.ts`
2. Existing primitive closest to the desired behavior.
3. `ui/a-ui-provider.tsx`
4. `ui/ui-classes.ts`

## Common Tasks

- Add primitive: implement one focused component and export it from `index.ts`.
- Change visual convention: update shared classes/provider before individual panels.
- Improve accessibility: preserve forwarded props, labels, focus, and keyboard behavior.

## Important Constraints

- Keep primitives domain-neutral and composable.
- Do not hide network calls or workspace state inside controls.
- Preserve accessibility semantics while wrapping third-party components.
- Avoid introducing a second styling convention.

## Related Modules

- Consumers -> `../app/AI_CONTEXT.md`.
- Global styles -> `../app/globals.css`.

