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
