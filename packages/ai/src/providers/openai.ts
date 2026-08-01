import {
  flattenGenerationInput,
  isStructuredGenerationInput,
  type EmbeddingProvider,
  type GenerationInput,
  type GenerationMetadata,
  type GenerationOptions,
  type LLMProvider
} from "../index.js";

type OpenAIResponseBody = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  status?: string;
  incomplete_details?: { reason?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
  };
};

const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "people",
    "aliases",
    "places",
    "parcels",
    "dates",
    "organizations",
    "documentType",
    "relationships",
    "claims",
    "summary"
  ],
  properties: {
    people: { type: "array", items: { type: "string" } },
    aliases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["canonical", "aliases"],
        properties: {
          canonical: { type: "string" },
          aliases: { type: "array", items: { type: "string" } }
        }
      }
    },
    places: { type: "array", items: { type: "string" } },
    parcels: { type: "array", items: { type: "string" } },
    dates: { type: "array", items: { type: "string" } },
    organizations: { type: "array", items: { type: "string" } },
    documentType: { type: ["string", "null"] },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "relation", "target", "evidence"],
        properties: {
          source: { type: "string" },
          relation: { type: "string" },
          target: { type: "string" },
          evidence: { type: "string" }
        }
      }
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "predicate", "object", "date", "dateStart", "dateEnd", "dateText", "evidence"],
        properties: {
          subject: { type: "string" }, predicate: { type: "string" }, object: { type: "string" },
          date: { type: ["string", "null"] }, dateStart: { type: ["string", "null"] }, dateEnd: { type: ["string", "null"] }, dateText: { type: ["string", "null"] }, evidence: { type: "string" }
        }
      }
    },
    summary: { type: "string" }
  }
} as const;

// JSON extraction may include many entities and archival identifiers. Keep a
// larger response budget than conversational defaults so the object closes
// cleanly instead of ending with Responses' max_output_tokens status.
const structuredJsonMaxOutputTokens = 16_384;

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly temperature: number) {}

  async generate(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): Promise<string> {
    const cacheEnabled = isStructuredGenerationInput(input) && input.cache?.mode === "auto" && Boolean(input.stablePrefix);
    const prompt = flattenGenerationInput(input);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      // Reasoning models such as GPT-5 reject temperature. Omit it here so one
      // provider implementation works across the configured OpenAI models.
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        ...(cacheEnabled && input.cache?.namespace ? { prompt_cache_key: input.cache.namespace } : {}),
        ...(options?.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {})
      }),
      signal
    });
    if (!response.ok) throw new Error(`OpenAI response failed with ${response.status}: ${await response.text()}`);
    const body = await response.json() as OpenAIResponseBody;
    safelyReport(options, openAiMetadata(this.model, body, cacheEnabled));
    return getOutputText(body);
  }

  async *generateStream(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): AsyncIterable<string> {
    yield await this.generate(input, signal, options);
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        // Metadata objects can contain several list fields (people, places,
        // organizations, keywords, and notes). Keep enough room for the
        // complete JSON object so Responses does not stop mid-generation.
        max_output_tokens: structuredJsonMaxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "document_extraction",
            strict: true,
            schema: extractionJsonSchema
          }
        }
      }),
      signal
    });

    if (!response.ok) throw new Error(`OpenAI response failed with ${response.status}: ${await response.text()}`);

    const body = await response.json() as OpenAIResponseBody;
    const outputText = getOutputText(body);

    if (!outputText) {
      const reason = body.incomplete_details?.reason ?? body.status ?? "empty output";
      throw new Error(`OpenAI did not return a complete JSON response (${reason}).`);
    }

    return JSON.parse(outputText) as T;
  }

  async generateJsonObject<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        max_output_tokens: structuredJsonMaxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "metadata",
            strict: false,
            schema: { type: "object", additionalProperties: true }
          }
        }
      }),
      signal
    });

    if (!response.ok) throw new Error(`OpenAI response failed with ${response.status}: ${await response.text()}`);
    const body = await response.json() as OpenAIResponseBody;
    const outputText = getOutputText(body);
    if (!outputText) {
      const reason = body.incomplete_details?.reason ?? body.status ?? "empty output";
      throw new Error(`OpenAI did not return a complete JSON response (${reason}).`);
    }
    return JSON.parse(outputText) as T;
  }
}

function openAiMetadata(model: string, body: OpenAIResponseBody, cacheEnabled: boolean): GenerationMetadata {
  const details = body.usage?.input_tokens_details;
  const cached = details?.cached_tokens;
  const created = details?.cache_write_tokens;
  const cacheStatus = !cacheEnabled
    ? "DISABLED"
    : typeof cached !== "number" && typeof created !== "number"
      ? "UNKNOWN"
      : cached && cached > 0
        ? "HIT"
        : created && created > 0
          ? "CREATED"
          : "MISS";
  return {
    provider: "openai",
    model,
    cacheStatus,
    usage: body.usage ? {
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
      cachedInputTokens: cached,
      cacheCreationInputTokens: created
    } : undefined
  };
}

function safelyReport(options: GenerationOptions | undefined, metadata: GenerationMetadata) {
  try { options?.onMetadata?.(metadata); } catch { /* Telemetry must never fail generation. */ }
}

function getOutputText(body: OpenAIResponseBody) {
  if (body.output_text) {
    return body.output_text;
  }

  return body.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("") ?? "";
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      // text-embedding-3 models support dimension reduction.  Normalizing to
      // 1024 lets this provider share the database index with Ollama and Gemini.
      body: JSON.stringify({ model: this.model, input: text, dimensions: 1024 })
    });
    if (!response.ok) {
      throw new Error(`OpenAI embedding failed with ${response.status}: ${await response.text()}`);
    }
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = body.data?.[0]?.embedding;
    if (!embedding?.length || !embedding.every(Number.isFinite)) {
      throw new Error("OpenAI embedding response was empty or invalid.");
    }
    return embedding;
  }
}
