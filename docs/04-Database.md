# Database Design

## PostgreSQL Extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

## workspaces

- id
- name
- slug
- description
- storage_path
- created_at
- updated_at

## documents

- id
- workspace_id
- filename
- title
- content
- normalized_content
- source_original_path
- markdown_path
- summary
- document_type
- document_date
- status
- hash
- indexed_at
- created_at
- updated_at

## document_chunks

- id
- document_id
- chunk_index
- heading
- content
- normalized_content
- token_count
- embedding
- created_at

## entities

- id
- workspace_id
- type
- canonical_value
- normalized_value
- created_at
- updated_at

Types:

- PERSON
- PLACE
- PARCEL
- DATE
- ORGANIZATION
- DOCUMENT_TYPE
- CASE_NUMBER
- NOTARY_NUMBER
- PROPERTY
- EVENT

## entity_aliases

- id
- entity_id
- alias
- normalized_alias
- confidence
- source
- created_at

source:

- LLM
- REGEX
- USER
- IMPORT

## document_entities

- id
- document_id
- entity_id
- occurrence_count
- evidence_snippet
- confidence
- created_at

## relationships

- id
- workspace_id
- document_id
- source_entity_id
- relation
- target_entity_id
- evidence_snippet
- confidence
- created_at

## backups

- id
- workspace_id
- file_path
- created_at
- note

## snapshots

- id
- workspace_id
- name
- description
- file_path
- created_at

## chat_sessions

- id
- workspace_id
- title
- created_at
- updated_at

## chat_messages

- id
- session_id
- role
- content
- query_type
- sources_json
- created_at

## Kritik Test

```text
Ali Çobanoğlu hangi belgelerde geçiyor?
```

Sistem şu aliasları yakalamalı:

- Ali Çobanoğlu
- Ali Zeki Çobanoğlu
- Ali Çavanoğlu

ve ilgili belgeleri eksiksiz döndürmelidir.
