-- Non-destructive indexes for workspace-scoped lexical and metadata retrieval.
create index if not exists "documents_workspace_status_type_date_idx" on "documents" using btree ("workspace_id", "status", "document_type", "document_date");
create index if not exists "document_chunks_normalized_content_trgm_idx" on "document_chunks" using gin ("normalized_content" gin_trgm_ops);
create index if not exists "entity_aliases_normalized_alias_trgm_idx" on "entity_aliases" using gin ("normalized_alias" gin_trgm_ops);
