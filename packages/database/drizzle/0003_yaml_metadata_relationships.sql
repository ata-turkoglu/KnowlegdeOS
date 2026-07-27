-- YAML keywords are searchable entities rather than being misclassified as events.
ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'KEYWORD';

-- YAML-derived fields are promoted for fast document filtering.
CREATE INDEX IF NOT EXISTS documents_workspace_document_type_idx
  ON documents(workspace_id, document_type);
CREATE INDEX IF NOT EXISTS documents_workspace_document_date_idx
  ON documents(workspace_id, document_date);

-- Backup records were present in the initial schema; this index supports the
-- backup-history endpoint added after that schema was deployed.
CREATE INDEX IF NOT EXISTS backups_workspace_created_at_idx
  ON backups(workspace_id, created_at DESC);
