import type { EmbeddingProvider, LLMProvider } from "../index.js";

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
    summary: { type: "string" }
  }
} as const;

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly temperature: number) {}

  async generate(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: prompt, temperature: this.temperature }), signal
    });
    if (!response.ok) throw new Error(`OpenAI response failed with ${response.status}`);
    const body = await response.json() as OpenAIResponseBody;
    return getOutputText(body);
  }

  async generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        temperature: this.temperature,
        max_output_tokens: 4096,
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

    if (!response.ok) throw new Error(`OpenAI response failed with ${response.status}`);

    const body = await response.json() as OpenAIResponseBody;
    const outputText = getOutputText(body);

    if (!outputText) {
      const reason = body.incomplete_details?.reason ?? body.status ?? "empty output";
      throw new Error(`OpenAI did not return a complete JSON response (${reason}).`);
    }

    return JSON.parse(outputText) as T;
  }
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
      body: JSON.stringify({ model: this.model, input: text })
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
