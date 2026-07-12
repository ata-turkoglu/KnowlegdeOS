# API Design

## Workspaces

### GET /api/workspaces

### POST /api/workspaces

### GET /api/workspaces/:id

### POST /api/workspaces/:id/export

### POST /api/workspaces/import

## Documents

### POST /api/documents/upload

Markdown dosyası yükler. Opsiyonel original file alabilir.

### GET /api/documents

### GET /api/documents/:id

### DELETE /api/documents/:id

### POST /api/documents/:id/reindex

### POST /api/documents/reindex-all

## Upload Helper

### GET /api/prompts/ocr-markdown

Upload panelinde gösterilecek ChatGPT promptunu döndürür.

## Entities

### GET /api/entities

### GET /api/entities/:id

### GET /api/entities/:id/documents

### POST /api/entities/:id/aliases

### POST /api/entities/merge

## Search

### POST /api/search/entity

### POST /api/search/semantic

### POST /api/search/hybrid

## Chat

### POST /api/chat

## Backups

### POST /api/backups/create

### POST /api/backups/restore

### GET /api/backups

## Snapshots

### POST /api/snapshots

### GET /api/snapshots

### POST /api/snapshots/:id/restore
