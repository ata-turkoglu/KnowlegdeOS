# AI Engine

## Amaç

Yerel LLM ve embedding modellerini yönetmek.

## LLM Provider

```ts
interface LLMProvider {
  generate(prompt: string): Promise<string>;
  generateJson<T>(prompt: string): Promise<T>;
}
```

İlk implementasyon:

- OllamaProvider

## Embedding Provider

```ts
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
```

## Prompt Türleri

- OCR Markdown conversion prompt
- entity extraction prompt
- summary prompt
- relationship extraction prompt
- query classification prompt
- final answer prompt

## OCR Markdown Conversion Prompt

Bu prompt uygulamanın upload panelinde kullanıcıya gösterilir. Kullanıcı taranmış belgeyi ChatGPT'ye yükleyip bu prompt ile Markdown çıktısı alır.

Bu sistemin parçasıdır ve `17-OCR-Markdown-Prompt.md` dosyasında detaylandırılmıştır.

## AI Kuralları

- Bilgi uydurma
- Verilen belgeye dayan
- Türkçe karakterleri koru
- Emin olmadığın yerleri `[okunamadı]` olarak işaretle
- Orijinal sayfa yapısını mümkün olduğunca koru
