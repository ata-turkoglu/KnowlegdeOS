ALTER TYPE entity_alias_source ADD VALUE IF NOT EXISTS 'FRONTMATTER';

CREATE TABLE IF NOT EXISTS property_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  place text,
  normalized_place text,
  sheet text,
  block text,
  parcel text NOT NULL,
  normalized_key text NOT NULL,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  source entity_alias_source NOT NULL DEFAULT 'REGEX',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_references_workspace_id_idx
  ON property_references(workspace_id);
CREATE INDEX IF NOT EXISTS property_references_document_id_idx
  ON property_references(document_id);
CREATE INDEX IF NOT EXISTS property_references_normalized_key_idx
  ON property_references(normalized_key);
CREATE UNIQUE INDEX IF NOT EXISTS property_references_document_key_unique
  ON property_references(document_id, normalized_key);
