import type { EmbeddingProvider, LLMProvider } from "../index.js";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements LLMProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generate(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${baseUrl}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }), signal
    });
    if (!response.ok) throw new Error(`Gemini response failed with ${response.status}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await this.generate(prompt, signal)) as T;
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${baseUrl}/${this.model}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 })
    });
    if (!response.ok) throw new Error(`Gemini embedding failed with ${response.status}`);
    const body = await response.json() as { embedding?: { values?: number[] } };
    if (!body.embedding?.values?.length) throw new Error("Gemini embedding response was empty.");
    return body.embedding.values;
  }
}
