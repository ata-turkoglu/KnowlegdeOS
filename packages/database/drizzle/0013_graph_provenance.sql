ALTER TABLE entity_aliases
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS evidence_snippet text;

ALTER TABLE relationships
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text;

CREATE INDEX IF NOT EXISTS entity_aliases_document_id_idx ON entity_aliases(document_id);
CREATE INDEX IF NOT EXISTS relationships_provider_model_idx ON relationships(provider, model);
