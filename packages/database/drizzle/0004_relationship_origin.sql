ALTER TABLE relationships
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'LLM';

ALTER TABLE relationships
  ADD CONSTRAINT relationships_origin_check
  CHECK (origin IN ('RULE', 'LLM'));

CREATE INDEX IF NOT EXISTS relationships_document_origin_idx
  ON relationships(document_id, origin);
