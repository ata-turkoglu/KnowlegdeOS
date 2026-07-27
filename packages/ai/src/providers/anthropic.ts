import {
  flattenGenerationInput,
  isStructuredGenerationInput,
  type GenerationInput,
  type GenerationMetadata,
  type GenerationOptions,
  type GenerationUsage,
  type LLMProvider
} from "../index.js";

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type AnthropicMessage = {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: AnthropicUsage;
};

type AnthropicStreamEvent = {
  type?: string;
  delta?: { text?: string };
  message?: { usage?: AnthropicUsage };
  usage?: AnthropicUsage;
};

/** Minimal Messages API client; keys stay server-side and no unsupported embedding API is exposed. */
export class AnthropicProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature: number,
    private readonly baseUrl = "https://api.anthropic.com",
    private readonly timeoutMs = 120_000
  ) {}

  async generate(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions) {
    const response = await this.fetchMessage(input, signal, options?.maxOutputTokens, false);
    const body = await response.json() as AnthropicMessage;
    const text = body.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
    if (!text) throw new Error(`Anthropic returned no text (${body.stop_reason ?? "unknown"}).`);
    safelyReport(options, anthropicMetadata(this.model, body.usage, isCacheEnabled(input)));
    return text;
  }

  async *generateStream(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): AsyncIterable<string> {
    const response = await this.fetchMessage(input, signal, options?.maxOutputTokens, true);
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: AnthropicUsage | undefined;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data) as AnthropicStreamEvent;
          usage = mergeUsage(usage, event.message?.usage ?? event.usage);
          if (event.type === "content_block_delta" && event.delta?.text) yield event.delta.text;
        }
      }
    } finally {
      reader.releaseLock();
    }
    safelyReport(options, anthropicMetadata(this.model, usage, isCacheEnabled(input)));
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return this.json<T>(prompt, signal);
  }

  async generateJsonObject<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    return this.json<T>(prompt, signal);
  }

  private async json<T>(prompt: string, signal?: AbortSignal) {
    const text = await this.generate(`${prompt}\nReturn only a valid JSON object.`, signal, { maxOutputTokens: 4096 });
    try { return JSON.parse(text) as T; } catch { throw new Error("Anthropic returned invalid JSON."); }
  }

  private async fetchMessage(input: GenerationInput, signal: AbortSignal | undefined, maxOutputTokens: number | undefined, stream: boolean) {
    const timeoutSignal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
    const requestSignal = signal && timeoutSignal ? AbortSignal.any([signal, timeoutSignal]) : signal ?? timeoutSignal;
    const cacheEnabled = isCacheEnabled(input);
    const stablePrefix = isStructuredGenerationInput(input) ? input.stablePrefix?.trim() : undefined;
    const prompt = cacheEnabled && isStructuredGenerationInput(input) ? input.dynamicPrompt : flattenGenerationInput(input);
    const requestBody = {
      model: this.model,
      max_tokens: maxOutputTokens ?? 1024,
      temperature: this.temperature,
      ...(cacheEnabled && stablePrefix ? {
        system: [{
          type: "text",
          text: stablePrefix,
          cache_control: { type: "ephemeral" }
        }]
      } : {}),
      messages: [{ role: "user", content: prompt }],
      stream
    };
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody),
      signal: requestSignal
    });
    if (!response.ok) {
      const kind = response.status === 401 || response.status === 403
        ? "authentication"
        : response.status === 429
          ? "rate limit"
          : response.status >= 500
            ? "server"
            : "request";
      throw new Error(`Anthropic ${kind} error (${response.status}).`);
    }
    return response;
  }
}

function isCacheEnabled(input: GenerationInput) {
  return isStructuredGenerationInput(input) && input.cache?.mode === "auto" && Boolean(input.stablePrefix?.trim());
}

function mergeUsage(current: AnthropicUsage | undefined, incoming: AnthropicUsage | undefined) {
  if (!incoming) return current;
  return {
    ...current,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => typeof value === "number"))
  };
}

function anthropicMetadata(model: string, usage: AnthropicUsage | undefined, cacheEnabled: boolean): GenerationMetadata {
  const normalized: GenerationUsage | undefined = usage ? {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens
  } : undefined;
  const cacheStatus = !cacheEnabled
    ? "DISABLED"
    : typeof usage?.cache_read_input_tokens !== "number" && typeof usage?.cache_creation_input_tokens !== "number"
      ? "UNKNOWN"
      : usage.cache_read_input_tokens && usage.cache_read_input_tokens > 0
        ? "HIT"
        : usage.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0
          ? "CREATED"
          : "MISS";
  return { provider: "anthropic", model, usage: normalized, cacheStatus };
}

function safelyReport(options: GenerationOptions | undefined, metadata: GenerationMetadata) {
  try { options?.onMetadata?.(metadata); } catch { /* Telemetry must never fail generation. */ }
}
