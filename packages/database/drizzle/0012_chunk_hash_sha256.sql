CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE document_chunks
SET content_hash = encode(digest(convert_to(content, 'UTF8'), 'sha256'), 'hex');
