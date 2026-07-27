-- The legacy semantic index and default bge-m3 provider use 1024 dimensions.
-- Stored 384-dimensional vectors cannot be cast to 1024, so they are explicitly
-- marked stale and rebuilt; source markdown and legacy embeddings.json remain intact.
DROP INDEX IF EXISTS document_chunks_embedding_present_idx;
DROP INDEX IF EXISTS document_chunks_embedding_idx;
UPDATE document_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING embedding::text::vector(1024);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_present_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
