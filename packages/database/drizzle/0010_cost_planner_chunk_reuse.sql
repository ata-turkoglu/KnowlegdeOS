ALTER TABLE document_chunks ADD COLUMN content_hash text;
UPDATE document_chunks SET content_hash = md5(content) WHERE content_hash IS NULL;
ALTER TABLE document_chunks ALTER COLUMN content_hash SET NOT NULL;
ALTER TABLE document_chunks ADD COLUMN embedding_model text;
UPDATE document_chunks c
SET embedding_model = d.embedding_model
FROM documents d
WHERE d.id = c.document_id AND c.embedding IS NOT NULL;
CREATE INDEX document_chunks_content_hash_idx ON document_chunks(content_hash);
CREATE INDEX document_chunks_embedding_reuse_idx
  ON document_chunks(content_hash, embedding_model)
  WHERE embedding IS NOT NULL;

ALTER TABLE document_entities
  ADD COLUMN max_chunk_mentions integer NOT NULL DEFAULT 0;
