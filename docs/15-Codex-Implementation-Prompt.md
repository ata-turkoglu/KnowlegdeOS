# Codex Implementation Prompt

You are building KnowledgeOS.

KnowledgeOS is a local-first AI-powered document archive and knowledge management system.

Do not use AnythingLLM.

Do not use cloud services.

Do not use external AI APIs.

Everything must run locally.

## Read Docs First

Before coding, read every markdown file in the docs folder.

## Main Goal

Build a local app that correctly answers archive/entity questions.

Critical test:

```text
Ali Çobanoğlu hangi belgelerde geçiyor?
```

Expected answer must include A-1, A-2 and A-8 when aliases match.

## Important New Requirement

Scanned paper documents are converted to Markdown outside the app using ChatGPT.

The upload panel must show a copyable prompt template that helps the user ask ChatGPT to convert scanned PDF/JPG/PNG/TIFF documents into KnowledgeOS-compatible Markdown.

The app must allow uploading:

1. Markdown working copy
2. Optional original scanned file

Original files are evidence. Markdown is the AI-readable indexed content.

## MVP Scope

Build:

- monorepo
- Fastify API
- Next.js UI
- PostgreSQL
- Drizzle ORM
- local storage
- workspace system
- markdown upload
- original file optional upload
- OCR prompt panel in upload UI
- document list
- document detail
- deterministic extraction
- entity aliases
- entity search
- chat page for ENTITY_SEARCH
- source transparency

Do not implement built-in OCR yet.

## Architecture

Use:

```text
apps/api
apps/web
packages/shared
packages/database
packages/ingestion
packages/search
packages/ai
```

## Rules

1. Do not rely only on vector search.
2. Entity search must use SQL, aliases, full text search and fuzzy matching.
3. LLM must not decide which documents contain an entity if SQL can decide.
4. Every chat response must show query type and sources.
5. Everything must be local.
6. Workspace export/import must be supported in architecture.
7. Upload UI must include ChatGPT OCR-to-Markdown prompt.
8. Start with Sprint 1 from Roadmap.
