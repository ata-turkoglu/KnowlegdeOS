# Architecture

## Genel Mimari

```text
Scanned Original Files
PDF / JPG / PNG / TIFF
        │
        ▼
External OCR / ChatGPT Markdown Conversion
        │
        ▼
Markdown Working Copy
        │
        ▼
KnowledgeOS Upload
        │
        ▼
Ingestion Engine
        ├── Normalize
        ├── Chunk
        ├── Deterministic extraction
        ├── LLM extraction
        ├── Alias resolution
        ├── Relationship extraction
        └── Embedding
        │
        ▼
PostgreSQL + pgvector
        │
        ▼
Search Engine
        ├── Entity Search
        ├── Full Text Search
        ├── Fuzzy Search
        ├── Semantic Search
        └── Hybrid Search
        │
        ▼
AI Engine
        │
        ▼
Next.js UI
```

## Dosya Saklama Mimarisi

```text
storage/
  workspaces/
    merter-arsivi/
      originals/
        A-1.pdf
        A-1_page_001.jpg
      markdown/
        A-1_Baki_Toksal_Ali_Cobanoglu.md
      metadata/
        A-1.json
      exports/
      backups/
```

## Önemli Karar

Orijinal tarama dosyaları saklanır ama indekslenen ana içerik Markdown'dır.

Bu sayede:

- OCR hataları elle düzeltilebilir
- AI için temiz metin sağlanır
- Obsidian uyumu korunur
- Taşınabilirlik kolaylaşır

## Workspace

Her arşiv ayrı workspace olabilir.

Örnek:

- Merter Arşivi
- Maden Analizleri
- Teknik Belgeler

Her workspace kendi belgelerine, entity'lerine, chat geçmişine ve ayarlarına sahiptir.

## Export / Import

Workspace zip olarak dışa aktarılabilmelidir.

```text
workspace-export.zip
  storage/
  database.dump
  config.json
  version.json
```
