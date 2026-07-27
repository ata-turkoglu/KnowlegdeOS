import type { EmbeddingProvider, LLMProvider } from "../index.js";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements LLMProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly temperature: number) {}

  async generate(prompt: string, signal?: AbortSignal, options?: { maxOutputTokens?: number }): Promise<string> {
    return this.request(prompt, signal, undefined, options?.maxOutputTokens);
  }

  async *generateStream(prompt: string, signal?: AbortSignal, options?: { maxOutputTokens?: number }): AsyncIterable<string> {
    yield await this.generate(prompt, signal, options);
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await this.request(prompt, signal, "application/json")) as T;
  }

  async generateJsonObject<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return this.generateJson<T>(prompt, signal);
  }

  private async request(prompt: string, signal?: AbortSignal, responseMimeType?: "application/json", maxOutputTokens?: number): Promise<string> {
    const response = await fetch(`${baseUrl}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { ...(responseMimeType ? { responseMimeType } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}), temperature: this.temperature } }), signal
    });
    if (!response.ok) throw new Error(`Gemini response failed with ${response.status}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${baseUrl}/${this.model}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      // Keep every supported embedding provider compatible with the shared
      // pgvector(1024) column and its HNSW index.
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 1024 })
    });
    if (!response.ok) {
      throw new Error(`Gemini embedding failed with ${response.status}: ${await response.text()}`);
    }
    const body = await response.json() as { embedding?: { values?: number[] } };
    if (!body.embedding?.values?.length || !body.embedding.values.every(Number.isFinite)) {
      throw new Error("Gemini embedding response was empty or invalid.");
    }
    return body.embedding.values;
  }
}
