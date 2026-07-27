-- Derived document data is persisted in PostgreSQL. Source markdown remains on disk.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ingestion_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS llm_extraction jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS llm_extraction_error text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_model text;

-- A filename is the stable upload identity inside a workspace. Hash remains indexed
-- separately so imports can also match renamed documents safely.
CREATE UNIQUE INDEX IF NOT EXISTS documents_workspace_filename_unique
  ON documents(workspace_id, filename);
CREATE INDEX IF NOT EXISTS documents_workspace_status_idx
  ON documents(workspace_id, status);
CREATE INDEX IF NOT EXISTS documents_metadata_gin_idx
  ON documents USING gin (metadata);

-- Existing initial migration creates the HNSW index. This partial index avoids empty
-- vectors competing in similarity scans on databases upgraded from older installs.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_present_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
