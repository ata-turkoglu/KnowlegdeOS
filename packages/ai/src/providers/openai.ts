import type { EmbeddingProvider, LLMProvider } from "../index.js";

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generate(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: prompt, temperature: 0 }), signal
    });
    if (!response.ok) throw new Error(`OpenAI response failed with ${response.status}`);
    const body = await response.json() as { output_text?: string };
    return body.output_text ?? "";
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await this.generate(prompt, signal)) as T;
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: text })
    });
    if (!response.ok) throw new Error(`OpenAI embedding failed with ${response.status}`);
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = body.data?.[0]?.embedding;
    if (!embedding?.length) throw new Error("OpenAI embedding response was empty.");
    return embedding;
  }
}
