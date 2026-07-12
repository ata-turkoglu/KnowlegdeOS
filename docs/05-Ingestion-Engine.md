# Ingestion Engine

## Amaç

Yüklenen Markdown dosyasını bilgi modeline dönüştürmek.

## Giriş Formatları

MVP için ana giriş:

- .md
- .txt

Desteklenecek ama indeksleme öncesi Markdown'a çevrilmesi önerilecek formatlar:

- .pdf
- .jpg
- .png
- .tiff
- .docx

## Önerilen İş Akışı

```text
Taranmış belge
↓
ChatGPT ile OCR + Markdown dönüşümü
↓
Kullanıcı md dosyasını kontrol eder
↓
KnowledgeOS'a yükler
↓
Ingestion çalışır
```

## Upload Panelinde Gösterilecek Bilgi

Belge yükleme ekranında kullanıcıya şu açıklama gösterilmelidir:

> En iyi sonuç için taranmış belgeyi önce ChatGPT ile Markdown formatına çevirin. Aşağıdaki promptu ChatGPT'ye yapıştırıp görüntü veya PDF'den KnowledgeOS uyumlu Markdown çıktısı alın. Sonra oluşan `.md` dosyasını bu ekrana yükleyin.

Ayrıca prompt kopyalama butonu olmalıdır.

## Pipeline

```text
Upload markdown
↓
Save raw markdown
↓
Normalize
↓
Chunk
↓
Deterministic extraction
↓
LLM extraction
↓
Merge extraction results
↓
Alias resolution
↓
Embedding
↓
Save indexed document
```

## Deterministic Extraction

Regex ile çıkarılacaklar:

- kişi adayları
- parsel numaraları
- ada/pafta/parsel
- tarihler
- dava numaraları
- karar numaraları
- yevmiye numaraları
- noter adları

## LLM Extraction

LLM şunları çıkarır:

- people
- aliases
- places
- parcels
- dates
- organizations
- document type
- relationships
- summary

## Markdown Standardı

KnowledgeOS'a yüklenen Markdown dosyalarında mümkünse YAML frontmatter olmalıdır.

Örnek:

```md
---
document_code: A-8
title: Sulh ve Taksim Anlaşması
source_original: A-8.pdf
ocr_status: human_checked
language: tr
---

# A-8 Sulh ve Taksim Anlaşması

[Sayfa 1]

Belge metni...
```
