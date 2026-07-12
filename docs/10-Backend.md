# Backend

## Modules

- documents
- workspaces
- ingestion
- entities
- search
- chat
- ai
- backups
- snapshots

## Local Storage

Backend dosyaları şu yapıda saklar:

```text
storage/workspaces/{workspaceSlug}/
  originals/
  markdown/
  metadata/
  exports/
  backups/
```

## Upload Behavior

Kullanıcı Markdown yükleyebilir.

Opsiyonel olarak orijinal tarama dosyasını da yükleyebilir.

Database'de ikisinin ilişkisi tutulur:

- markdown_path
- source_original_path

## API sadece localhost için tasarlanır

MVP'de auth yoktur.

## Reindex

Belge tekrar indekslenebilir.

Kullanıcı tarafından eklenen aliaslar korunmalıdır.
