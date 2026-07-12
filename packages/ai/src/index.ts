export interface LLMProvider {
  generate(prompt: string, signal?: AbortSignal): Promise<string>;
  generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export type LLMRelationship = {
  source: string;
  relation: string;
  target: string;
  evidence: string;
};

export type LLMExtractionResult = {
  people: string[];
  aliases: Array<{
    canonical: string;
    aliases: string[];
  }>;
  places: string[];
  parcels: string[];
  dates: string[];
  organizations: string[];
  documentType: string | null;
  relationships: LLMRelationship[];
  summary: string;
};

export { buildEntityExtractionPrompt } from "./prompts.js";
export {
  OllamaEmbeddingProvider,
  OllamaProvider,
  checkOllamaHealth
} from "./providers/ollama.js";
export { OpenAIEmbeddingProvider, OpenAIProvider } from "./providers/openai.js";
export { GeminiEmbeddingProvider, GeminiProvider } from "./providers/gemini.js";

export const ocrMarkdownPrompt = `Aşağıdaki taranmış belgeyi KnowledgeOS uyumlu Markdown formatına çevir.

Kurallar:

1. Belgedeki metni OCR ile oku.
2. Orijinal metni mümkün olduğunca koru.
3. Türkçe karakterleri koru.
4. Emin olmadığın kelimeleri tahmin etme; \`[okunamadı]\` olarak işaretle.
5. Sayfa ayrımlarını \`[Sayfa 1]\`, \`[Sayfa 2]\` şeklinde belirt.
6. Belge üzerindeki başlıkları Markdown başlığına çevir.
7. Tablo varsa Markdown tablo olarak yaz.
8. İmza, mühür, kaşe, el yazısı, çizim, kroki gibi görsel unsurları köşeli parantez içinde belirt.
9. Belgedeki kişi, kurum, tarih, parsel, dava numarası gibi bilgileri değiştirme.
10. Modernleştirme, özetleme veya yorum yapma.
11. Sadece Markdown çıktısı ver.
12. Belgenin okunamayan yerlerini saklama, mutlaka \`[okunamadı]\` olarak göster.
13. Eğer aynı kişinin farklı yazımları varsa metinde geçtiği gibi bırak.
14. Satır sonlarını belge anlamını bozmayacak şekilde düzenle.
15. Belge birden fazla sayfadan oluşuyorsa her sayfanın başına sayfa etiketi koy.

Markdown dosyasının başına şu YAML metadata taslağını ekle:

---
document_code: ""
title: ""
source_original: ""
ocr_status: "chatgpt_ocr"
language: "tr"
document_type: ""
date: ""
people: []
places: []
parcels: []
notes: "Bu metin taranmış belgeden ChatGPT yardımıyla Markdown'a çevrilmiştir."
---

Ardından belge içeriğini şu formatta yaz:

# Belge Başlığı

[Sayfa 1]

Belge metni...

[Sayfa 2]

Belge metni...

Çıktıda açıklama yapma. Sadece Markdown ver.`;
