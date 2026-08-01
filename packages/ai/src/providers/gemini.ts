import { flattenGenerationInput, isStructuredGenerationInput, type EmbeddingProvider, type GenerationInput, type GenerationOptions, type LLMProvider } from "../index.js";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements LLMProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly temperature: number) {}

  async generate(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): Promise<string> {
    const text = await this.request(flattenGenerationInput(input), signal, undefined, options?.maxOutputTokens);
    try {
      options?.onMetadata?.({
        provider: "gemini",
        model: this.model,
        cacheStatus: isStructuredGenerationInput(input) && input.cache?.mode === "auto" ? "UNSUPPORTED" : "DISABLED"
      });
    } catch { /* Telemetry must never fail generation. */ }
    return text;
  }

  async *generateStream(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): AsyncIterable<string> {
    yield await this.generate(input, signal, options);
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await this.request(prompt, signal, "application/json")) as T;
  }

  async generateJsonObject<T>(prompt: string, signal?: AbortSignal, jsonSchema?: object): Promise<T> {
    return JSON.parse(await this.request(prompt, signal, "application/json", undefined, jsonSchema)) as T;
  }

  private async request(prompt: string, signal?: AbortSignal, responseMimeType?: "application/json", maxOutputTokens?: number, responseSchema?: object): Promise<string> {
    const response = await fetch(`${baseUrl}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { ...(responseMimeType ? { responseMimeType } : {}), ...(responseSchema ? { responseSchema } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}), temperature: this.temperature } }), signal
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
