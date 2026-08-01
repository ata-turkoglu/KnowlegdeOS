# Dynamic metadata and query analysis

Metadata field keys are workspace-scoped runtime data. `workspace_fields` is the
field catalog and the source of entity kinds; `entities.field_id` replaces the
old fixed `entity_type` enum.

## Lifecycle

1. YAML generation receives the current workspace field catalog.
2. Long Markdown is processed in bounded sections and merged into one flat
   metadata object.
3. Valid keys are canonicalized and upserted into `workspace_fields` before the
   YAML file is made visible.
4. Document indexing reads that YAML without another metadata LLM call.
5. Short entity-enabled values are upserted into `entities` and linked through
   `document_entities`.

New fields do not trigger historical document rescans. Scalar/list conflicts
widen the field type without discarding values.

## Query analysis

Every chat or search query first uses the complete registry for deterministic
validation, then sends at most 20 relevant workspace fields, 50 PostgreSQL
FTS/trigram entity candidates, and 20 metadata value candidates to the model.
The structured model result is
validated against the catalog. Provider failures fall back to deterministic
date, numeric-anchor, canonical entity, and alias matching.

Entity, lexical, and semantic retrieval share the resulting allowed document
set. A zero-result retry may remove low-confidence LLM filters, but never locked
dates, identifiers, or exact catalog matches.

The read-only field catalog endpoint is:

```text
GET /api/workspaces/:workspaceSlug/fields
```

Database migration `0008_dynamic_metadata_fields.sql` intentionally replaces
the fixed entity tables. Deploy it only with the planned database reset.
# Metadata policy contract

Built-in YAML metadata fields are defined once in `packages/shared/src/metadata-policy.ts`. Conversion validates provider output against that registry, retains chunk provenance, resolves scalar candidates deterministically, and unions only registered list fields. `date` and `date_text` are resolved as one scalar pair. Unknown LLM fields are rejected; legacy `organization` is accepted only as an alias of `organizations`.

Use `corepack pnpm metadata:audit --root=converted-markdown` before a regeneration. It is read-only unless an explicit `--output=<report.json>` path is supplied.

For a controlled workspace, first regenerate YAML from the Convert screen (or its YAML batch action), inspect the resulting trace files when `METADATA_DIAGNOSTICS_ENABLED=true`, then start that workspace's reindex operation in automatic mode. Do not run a production-wide regeneration until the audit report and a controlled reindex have been reviewed. The reindex endpoint is `POST /api/settings/ingestion/:workspaceSlug/reindex`; omit the deprecated `useLlm` field so the persisted stage plan can route deterministic and LLM-dependent stages independently. Set `INDEXING_DIAGNOSTICS_ENABLED=true` to retain bounded parsed stage traces under workspace metadata. Trace payloads are capped at 256 KB, redact token-shaped values, and expire after `INDEXING_DIAGNOSTICS_RETENTION_DAYS` (default 7). Raw provider transport payloads are deliberately not stored. Roll back a YAML regeneration by restoring the prior Markdown files from backup, then reindex the restored workspace.

For a controlled CLI rebuild, first run `corepack pnpm metadata:audit --root=converted-markdown`, then preview the stored-document scope with `corepack pnpm indexing:rebuild --workspace=<slug> --dry-run`. It makes no writes unless both `--apply --confirm-rebuild` are supplied, for example: `corepack pnpm indexing:rebuild --workspace=<slug> --batch-size=10 --apply --confirm-rebuild --output=rebuild-report.json`. The command rebuilds derived index data from stored Markdown/YAML and creates embeddings; YAML generation remains a separately reviewed conversion step.

To continue a previous report, reuse its path: `--resume --output=rebuild-report.json` skips documents already listed as indexed. `--retry-failed --output=rebuild-report.json` selects only previously failed documents. Both options retain the same explicit apply/confirmation requirement.

`12.06.1974 tarihli belgeler` is a document-date query and receives the canonical `date = 1974-06-12` metadata filter. `12.06.1974 tarihinde ne olmuştu?` is intentionally an event/content-date question: it keeps hybrid content retrieval and does not incorrectly restrict results to documents authored on that date.
