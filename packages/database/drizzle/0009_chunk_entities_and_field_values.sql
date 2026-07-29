CREATE TABLE document_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES workspace_fields(id) ON DELETE CASCADE,
  ordinal integer NOT NULL DEFAULT 0,
  text_value text,
  normalized_value text,
  date_value date,
  number_value real,
  boolean_value boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_field_values_document_id_idx ON document_field_values(document_id);
CREATE INDEX document_field_values_field_id_idx ON document_field_values(field_id);
CREATE INDEX document_field_values_normalized_value_idx ON document_field_values(normalized_value);
CREATE INDEX document_field_values_normalized_trgm_idx ON document_field_values USING gin (normalized_value gin_trgm_ops);
CREATE INDEX document_field_values_date_idx ON document_field_values(field_id, date_value);
CREATE INDEX document_field_values_number_idx ON document_field_values(field_id, number_value);
CREATE UNIQUE INDEX document_field_values_document_field_ordinal_unique
  ON document_field_values(document_id, field_id, ordinal);

ALTER TABLE document_entities RENAME COLUMN occurrence_count TO mention_count;
ALTER TABLE document_entities ALTER COLUMN mention_count SET DEFAULT 0;

CREATE TABLE chunk_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  mention_count integer NOT NULL DEFAULT 1,
  first_offset integer,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'TEXT_MATCH',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chunk_entities_chunk_id_idx ON chunk_entities(chunk_id);
CREATE INDEX chunk_entities_entity_id_idx ON chunk_entities(entity_id);
CREATE UNIQUE INDEX chunk_entities_chunk_entity_unique ON chunk_entities(chunk_id, entity_id);

ALTER TABLE relationships ADD COLUMN chunk_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL;

-- Co-occurrence is derived from document_entities/chunk_entities at runtime.
DELETE FROM relationships WHERE origin = 'RULE';
