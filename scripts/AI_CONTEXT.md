# Scripts Context

## Purpose

Repository maintenance, document preparation, and generated-document utilities.

## Responsibilities

- Generate deterministic artifacts from canonical sources.
- Provide bounded one-off document transformations used by maintainers.
- Keep operational scripts explicit and reviewable.

## Out of Scope

- Application runtime behavior, reusable domain libraries, and hidden production migrations.
- Editing private or broad directory trees without explicit targets.

## Architecture

- `generate-chat-workflow-doc.ts`: generates/checks chat workflow documentation from shared canonical stages.
- `apply_heading2_markers.py`: bounded Markdown preparation utility.
- `split-merter-b.ps1`: archive-specific source preparation utility.

## Dependencies

- Internal: shared canonical workflow for the TypeScript generator.
- External: Node/tsx, Python, or PowerShell depending on the script.
- Provides to: repository documentation and controlled source preparation.
- Must never depend on: web UI runtime or live API process state unless explicitly documented.

## Public APIs

- Root commands `docs:generate` and `docs:check`.
- Explicit command-line invocation for standalone preparation scripts.

## Entry Points

- Root `package.json` for supported repository commands.
- Individual script file for documented parameters.

## Key Files

1. Root `package.json`
2. Script being changed
3. Canonical input source
4. Expected generated/output artifact

## Common Tasks

- Change workflow generator: update shared source expectations and run generate/check.
- Add maintenance script: document input, output, safety boundary, idempotence, and invocation.
- Modify archive utility: test against a copied, explicit sample target.

## Important Constraints

- Generated output must be deterministic and support a check mode when practical.
- Resolve and validate paths before destructive or recursive operations.
- Never embed credentials or private document content.
- Prefer application/package code when behavior is part of the runtime product.

## Related Modules

- Canonical workflow -> `../packages/shared/AI_CONTEXT.md`.
- Documentation -> `../docs/AI_CONTEXT.md`.
- Repository commands -> `../AI_CONTEXT.md`.

