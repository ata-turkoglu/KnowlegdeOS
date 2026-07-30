CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL,
  subject_entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  subject_text text NOT NULL,
  predicate text NOT NULL,
  object_entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  object_text text NOT NULL,
  event_date date,
  event_date_start date,
  event_date_end date,
  date_text text,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 0.8,
  origin text NOT NULL DEFAULT 'LLM',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_workspace_id_idx ON claims(workspace_id);
CREATE INDEX claims_document_id_idx ON claims(document_id);
CREATE INDEX claims_subject_entity_id_idx ON claims(subject_entity_id);
CREATE INDEX claims_predicate_idx ON claims(predicate);
CREATE INDEX claims_event_date_idx ON claims(event_date);
