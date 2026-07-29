-- Dynamic metadata fields are the source of entity kinds. Existing entity data
-- is intentionally discarded: this migration is deployed with a database reset.
DROP TABLE IF EXISTS relationships CASCADE;
DROP TABLE IF EXISTS entity_aliases CASCADE;
DROP TABLE IF EXISTS document_entities CASCADE;
DROP TABLE IF EXISTS entities CASCADE;
DROP TYPE IF EXISTS entity_type;

CREATE TABLE workspace_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  value_type text NOT NULL DEFAULT 'TEXT'
    CHECK (value_type IN ('TEXT', 'TEXT_ARRAY', 'DATE', 'NUMBER', 'BOOLEAN')),
  filterable boolean NOT NULL DEFAULT true,
  entity_enabled boolean NOT NULL DEFAULT true,
  searchable boolean NOT NULL DEFAULT true,
  aliases text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_fields_workspace_id_idx ON workspace_fields(workspace_id);
CREATE UNIQUE INDEX workspace_fields_workspace_key_unique ON workspace_fields(workspace_id, key);
CREATE INDEX workspace_fields_key_trgm_idx ON workspace_fields USING gin (key gin_trgm_ops);

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES workspace_fields(id) ON DELETE CASCADE,
  canonical_value text NOT NULL,
  normalized_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entities_field_id_idx ON entities(field_id);
CREATE UNIQUE INDEX entities_field_normalized_unique ON entities(field_id, normalized_value);
CREATE INDEX entities_normalized_value_trgm_idx ON entities USING gin (normalized_value gin_trgm_ops);

CREATE TABLE entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  source entity_alias_source NOT NULL DEFAULT 'REGEX',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_aliases_entity_id_idx ON entity_aliases(entity_id);
CREATE UNIQUE INDEX entity_aliases_entity_normalized_unique ON entity_aliases(entity_id, normalized_alias);
CREATE INDEX entity_aliases_normalized_alias_trgm_idx ON entity_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE document_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  occurrence_count integer NOT NULL DEFAULT 1,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'FRONTMATTER',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_entities_document_id_idx ON document_entities(document_id);
CREATE INDEX document_entities_entity_id_idx ON document_entities(entity_id);
CREATE UNIQUE INDEX document_entities_document_entity_unique ON document_entities(document_id, entity_id);

CREATE TABLE relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  source_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation text NOT NULL,
  target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  origin text NOT NULL DEFAULT 'RULE',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relationships_workspace_id_idx ON relationships(workspace_id);
CREATE INDEX relationships_source_entity_id_idx ON relationships(source_entity_id);
CREATE INDEX relationships_target_entity_id_idx ON relationships(target_entity_id);
