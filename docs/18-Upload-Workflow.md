# Upload Workflow

## Amaç

Kullanıcıların taranmış eski belgeleri KnowledgeOS'a doğru formatta yüklemesini sağlamak.

## Önerilen Akış

```text
1. Belge taranır
2. PDF/JPG/PNG/TIFF oluşur
3. Kullanıcı ChatGPT'ye dosyayı yükler
4. KnowledgeOS upload panelindeki promptu ChatGPT'ye yapıştırır
5. ChatGPT Markdown çıktısı üretir
6. Kullanıcı Markdown çıktısını kontrol eder
7. .md dosyasını KnowledgeOS'a yükler
8. Orijinal tarama dosyasını opsiyonel kanıt dosyası olarak ekler
9. KnowledgeOS entity/search indeksini oluşturur
```

## Upload Panel Bölümleri

### 1. Markdown Dosyası

Zorunlu.

### 2. Orijinal Tarama Dosyası

Opsiyonel.

Desteklenenler:

- PDF
- JPG
- PNG
- TIFF

### 3. ChatGPT Prompt Yardımı

Kopyalanabilir prompt gösterilir.

### 4. Örnek Markdown

Kullanıcıya örnek çıktı gösterilir.

### 5. Önizleme

Yüklenen Markdown içeriği gösterilir.

### 6. İndeksleme

Kullanıcı "İndeksle" dediğinde ingestion başlar.

## Neden Böyle?

İlk sürümde yerel OCR geliştirmek yerine, kullanıcı zaten ChatGPT ile OCR yaptığı için bu süreci standartlaştırmak daha hızlı ve güvenilirdir.

İleride built-in OCR eklenebilir.
