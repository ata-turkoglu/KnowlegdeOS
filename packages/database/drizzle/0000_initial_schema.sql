CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE entity_type AS ENUM (
  'PERSON',
  'PLACE',
  'PARCEL',
  'DATE',
  'ORGANIZATION',
  'DOCUMENT_TYPE',
  'CASE_NUMBER',
  'NOTARY_NUMBER',
  'PROPERTY',
  'EVENT'
);

CREATE TYPE entity_alias_source AS ENUM (
  'LLM',
  'REGEX',
  'USER',
  'IMPORT'
);

CREATE TYPE document_status AS ENUM (
  'UPLOADED',
  'INDEXING',
  'INDEXED',
  'FAILED'
);

CREATE TYPE chat_role AS ENUM (
  'user',
  'assistant',
  'system'
);

CREATE TYPE query_type AS ENUM (
  'ENTITY_SEARCH',
  'SEMANTIC_SEARCH',
  'HYBRID_SEARCH'
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  storage_path text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  normalized_content text NOT NULL,
  source_original_path text,
  markdown_path text NOT NULL,
  summary text,
  document_type text,
  document_date date,
  status document_status NOT NULL DEFAULT 'UPLOADED',
  hash text NOT NULL,
  indexed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  heading text,
  content text NOT NULL,
  normalized_content text NOT NULL,
  token_count integer NOT NULL DEFAULT 0,
  embedding vector(384),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(document_id, chunk_index)
);

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type entity_type NOT NULL,
  canonical_value text NOT NULL,
  normalized_value text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, type, normalized_value)
);

CREATE TABLE entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  source entity_alias_source NOT NULL DEFAULT 'REGEX',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(entity_id, normalized_alias)
);

CREATE TABLE document_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  occurrence_count integer NOT NULL DEFAULT 1,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(document_id, entity_id)
);

CREATE TABLE relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  source_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation text NOT NULL,
  target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  evidence_snippet text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  note text
);

CREATE TABLE snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  file_path text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role chat_role NOT NULL,
  content text NOT NULL,
  query_type query_type,
  sources_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX documents_workspace_id_idx ON documents(workspace_id);
CREATE INDEX documents_hash_idx ON documents(hash);
CREATE INDEX documents_normalized_content_trgm_idx ON documents USING gin (normalized_content gin_trgm_ops);
CREATE INDEX document_chunks_document_id_idx ON document_chunks(document_id);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX entities_workspace_id_idx ON entities(workspace_id);
CREATE INDEX entities_normalized_value_trgm_idx ON entities USING gin (normalized_value gin_trgm_ops);
CREATE INDEX entity_aliases_entity_id_idx ON entity_aliases(entity_id);
CREATE INDEX entity_aliases_normalized_alias_trgm_idx ON entity_aliases USING gin (normalized_alias gin_trgm_ops);
CREATE INDEX document_entities_document_id_idx ON document_entities(document_id);
CREATE INDEX document_entities_entity_id_idx ON document_entities(entity_id);
CREATE INDEX relationships_workspace_id_idx ON relationships(workspace_id);
CREATE INDEX relationships_source_entity_id_idx ON relationships(source_entity_id);
CREATE INDEX relationships_target_entity_id_idx ON relationships(target_entity_id);
CREATE INDEX chat_sessions_workspace_id_idx ON chat_sessions(workspace_id);
CREATE INDEX chat_messages_session_id_idx ON chat_messages(session_id);
