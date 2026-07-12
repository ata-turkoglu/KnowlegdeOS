# Coding Standards

## Genel

- TypeScript strict mode açık olmalı
- Modüller küçük olmalı
- Route içinde business logic yazılmamalı
- AI provider ve search logic ayrılmalı
- Her modül test edilebilir olmalı

## No Cloud

Harici AI API çağrısı olmayacak.

## Prompt Files

Promptlar dosya olarak tutulmalı:

```text
packages/ai/prompts/
```

OCR markdown promptu da burada olmalıdır.

## Source Transparency

Chat cevabı her zaman kaynakları dönmelidir.

## Local-first

Varsayılan tüm pathler proje klasörünün altında olmalıdır.
