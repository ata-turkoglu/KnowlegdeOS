-- Matches getLexicalSemanticContext's exact full-text expression.
create index if not exists "document_chunks_simple_fts_idx"
  on "document_chunks"
  using gin (to_tsvector('simple', "normalized_content"));
