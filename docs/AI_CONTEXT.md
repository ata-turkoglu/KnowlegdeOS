# Documentation Context

## Purpose

Topical design, workflow, implementation, and operational documentation for KnowledgeOS.

## Responsibilities

- Explain architecture and invariants not obvious from local source code.
- Route readers to canonical code and generated artifacts.
- Preserve historical implementation prompts without making them canonical architecture.

## Out of Scope

- Module-level source navigation; use nearby source `AI_CONTEXT.md` files.
- Duplicating source code or generated workflow definitions.
- Private workspace/document content.

## Architecture

Documentation layers:

| Layer | Files |
| --- | --- |
| Project overview | `00-README.md` through `03-TechStack.md` |
| Core subsystems | `04-Database.md` through `11-API.md` |
| Standards/roadmap | `12-Coding-Standards.md` through `16-Portability-and-Backup.md` |
| Workflow guidance | `17-OCR-Markdown-Prompt.md`, `18-Upload-Workflow.md` |
| Focused current designs | `dynamic-metadata.md`, `execution-planner.md`, `rag-upgrade.md`, provider/model docs |
| Historical implementation prompts | numbered prompt files; use as context, not canonical runtime truth |

## Dependencies

- Consumes from: `PROJECT.md`, source code, migrations, and canonical workflow definitions.
- Provides to: maintainers and AI assistants.
- Must never depend on: generated build output or private storage data.
- External tooling: Mermaid renderers where diagrams are included.

## Public APIs

- Documentation links from `README.md`, `PROJECT.md`, and `AI_CONTEXT.md`.
- Generated chat workflow artifact managed by root docs scripts when present.

## Entry Points

- Repository navigation: `../AI_CONTEXT.md`.
- Project rules: `../PROJECT.md` and `CODEX-RULES.md`.
- Documentation index: `00-README.md`.

## Key Files

1. `../PROJECT.md`
2. `02-Architecture.md`
3. Topic-specific subsystem document
4. Focused current design document, if one exists
5. Canonical source files linked from that document

## Common Tasks

- Update architecture: change source/module context and `02-Architecture.md` together.
- Update chat workflow: edit shared canonical stages, run docs generator, then update explanatory text.
- Document new durable subsystem: add a focused concise file and link it from this index/root context.
- Retire obsolete guidance: mark it historical or replace links; do not silently conflict with code.

## Important Constraints

- Generated architecture/workflow files are changed through their generator.
- Keep links relative and validate every referenced path.
- Prefer concise tables, lists, and Mermaid diagrams over repeated prose.
- State whether a document is canonical, generated, current design, or historical prompt.
- Documentation changes accompany architecture, ingestion, retrieval, chat, model, security, and database changes.

## Related Modules

- Repository map -> `../AI_CONTEXT.md`.
- Backend -> `../apps/api/AI_CONTEXT.md`.
- Frontend -> `../apps/web/AI_CONTEXT.md`.
- Packages -> `../packages/AI_CONTEXT.md`.
- Generators -> `../scripts/AI_CONTEXT.md`.

