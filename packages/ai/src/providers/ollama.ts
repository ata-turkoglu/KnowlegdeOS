import type { EmbeddingProvider, LLMProvider } from "../index.js";

type OllamaGenerateResponse = {
  response?: string;
};

type OllamaEmbeddingResponse = {
  embedding?: number[];
  embeddings?: number[][];
};

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 60000
  ) {}

  async generate(prompt: string, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const timeout = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0
        }
      })
    }).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", abort);
    });

    if (!response.ok) {
      throw new Error(`Ollama generate failed with ${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    return body.response ?? "";
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    const text = await this.generate(prompt, signal);
    return JSON.parse(extractJson(text)) as T;
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 60000
  ) {}

  async embed(text: string): Promise<number[]> {
    try {
      return await this.embedWithEmbeddingsEndpoint(text);
    } catch {
      return this.embedWithEmbedEndpoint(text);
    }
  }

  private async embedWithEmbeddingsEndpoint(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: this.model,
        prompt: text
      })
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`Ollama embedding failed with ${response.status}`);
    }

    const body = (await response.json()) as OllamaEmbeddingResponse;
    const embedding = body.embedding ?? body.embeddings?.[0];

    if (!embedding || embedding.length === 0) {
      throw new Error("Ollama embedding response was empty.");
    }

    return embedding;
  }

  private async embedWithEmbedEndpoint(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: this.model,
        input: text
      })
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`Ollama embed failed with ${response.status}`);
    }

    const body = (await response.json()) as OllamaEmbeddingResponse;
    const embedding = body.embedding ?? body.embeddings?.[0];

    if (!embedding || embedding.length === 0) {
      throw new Error("Ollama embed response was empty.");
    }

    return embedding;
  }
}

export async function checkOllamaHealth(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/tags`);

  if (!response.ok) {
    return false;
  }

  return true;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}
