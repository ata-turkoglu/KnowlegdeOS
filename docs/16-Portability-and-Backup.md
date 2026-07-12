# Portability and Backup

## Amaç

KnowledgeOS projesi sonradan başka bilgisayara taşınabilmelidir.

## Workspace Export

Her workspace zip olarak dışa aktarılabilmelidir.

```text
knowledgeos-workspace-export.zip
  storage/
    originals/
    markdown/
    metadata/
  database.dump
  config.json
  version.json
```

## Workspace Import

Yeni bilgisayarda kullanıcı export zip dosyasını içe aktarır.

Sistem:

- belgeleri geri yükler
- metadata'yı geri yükler
- entity/alias ilişkilerini geri yükler
- embeddings'i geri yükler
- reindex gerekmeden açılır

## Backup

Backup dosyası:

```text
backup-2026-06-29.zip
```

içinde:

- PostgreSQL dump
- storage klasörü
- config
- version

bulunur.

## Snapshot

Snapshot kısa vadeli geri dönüş noktasıdır.

Yanlış entity merge, yanlış belge silme gibi durumlarda restore yapılabilir.

## Docker ve Non-Docker

Sistem iki şekilde çalışabilmelidir:

```bash
pnpm dev
```

veya

```bash
docker compose up -d
```

## Taşıma Adımları

1. Eski bilgisayarda workspace export al.
2. Yeni bilgisayarda KnowledgeOS kur.
3. Ollama ve PostgreSQL'i hazırla.
4. Workspace import yap.
5. Sistem reindex zorunlu olmadan açılmalı.
