import { flattenGenerationInput, isStructuredGenerationInput, type EmbeddingProvider, type GenerationInput, type GenerationOptions, type LLMProvider } from "../index.js";

type OllamaGenerateResponse = {
  response?: string;
  error?: string;
};

type OllamaEmbeddingResponse = {
  embedding?: number[];
  embeddings?: number[][];
};

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly temperature: number,
    private readonly keepAlive: string | number | null = "5m"
  ) {}

  async generate(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): Promise<string> {
    let output = "";
    for await (const chunk of this.generateStream(input, signal, options)) output += chunk;
    return output;
  }

  async *generateStream(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): AsyncIterable<string> {
    const response = await this.request(flattenGenerationInput(input), signal, undefined, options?.maxOutputTokens ?? 1024);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Ollama returned an empty response stream.");
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) yield parseGeneratedChunk(line);
      if (done) break;
    }
    if (pending.trim()) yield parseGeneratedChunk(pending);
    try {
      options?.onMetadata?.({
        provider: "ollama",
        model: this.model,
        cacheStatus: isStructuredGenerationInput(input) && input.cache?.mode === "auto" ? "UNSUPPORTED" : "DISABLED"
      });
    } catch { /* Telemetry must never fail generation. */ }
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    const text = await readGeneratedText(await this.request(prompt, signal, "json"));
    return JSON.parse(extractJson(text)) as T;
  }

  async generateJsonObject<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return this.generateJson<T>(prompt, signal);
  }

  private async request(prompt: string, signal?: AbortSignal, format?: "json", maxTokens?: number): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      // Local LLM generation intentionally has no wall-clock timeout. The
      // caller's signal still cancels a disconnected or explicitly aborted request.
      signal,
      body: JSON.stringify({
        model: this.model,
        prompt,
        ...(this.keepAlive === null ? {} : { keep_alive: this.keepAlive }),
        // Streaming makes Ollama send response headers immediately. With stream: false,
        // Node's built-in five-minute header timeout can terminate long generations.
        stream: true,
        ...(format ? { format } : {}),
        // Qwen 3 can spend a long time producing an internal reasoning trace.
        // Extraction needs structured facts, not a chain of thought.
        think: false,
        options: {
          temperature: this.temperature,
          ...(maxTokens ? { num_predict: maxTokens } : {})
        }
      })
    });

    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").trim();
      throw new Error(`Ollama generate failed with ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
    }

    return response;
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
    const timeout = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

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
    }).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

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
    const timeout = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

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
    }).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

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

async function readGeneratedText(response: Response) {
  const body = await response.text();
  const lines = body.trim().split(/\r?\n/).filter(Boolean);

  try {
    const chunks = lines.map((line) => JSON.parse(line) as OllamaGenerateResponse);
    const error = chunks.find((chunk) => chunk.error)?.error;
    if (error) throw new Error(`Ollama generate failed: ${error}`);
    return chunks.map((chunk) => chunk.response ?? "").join("");
  } catch (error) {
    if (error instanceof SyntaxError) return body;
    throw error;
  }
}

function parseGeneratedChunk(line: string) {
  if (!line.trim()) return "";
  const chunk = JSON.parse(line) as OllamaGenerateResponse;
  if (chunk.error) throw new Error(`Ollama generate failed: ${chunk.error}`);
  return chunk.response ?? "";
}
