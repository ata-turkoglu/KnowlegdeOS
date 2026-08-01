export type GenerationInput =
  | string
  | {
      stablePrefix?: string;
      dynamicPrompt: string;
      cache?: {
        mode: "auto" | "off";
        namespace?: string;
      };
    };

export type GenerationUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type GenerationMetadata = {
  provider: "ollama" | "openai" | "gemini" | "anthropic";
  model: string;
  usage?: GenerationUsage;
  cacheStatus: "HIT" | "MISS" | "CREATED" | "UNSUPPORTED" | "DISABLED" | "UNKNOWN";
};

export type GenerationOptions = {
  maxOutputTokens?: number;
  onMetadata?: (metadata: GenerationMetadata) => void;
  /**
   * Opt-in capture of the model's generated text. This is deliberately the
   * model output, not the provider's HTTP transport payload: credentials,
   * headers, request prompts, and provider-only fields never cross this
   * contract. Callers remain responsible for choosing a private retention
   * location.
   */
  rawOutput?: {
    enabled: boolean;
    maxCharacters?: number;
    onOutput: (output: RawModelOutput) => void;
  };
};

export type RawModelOutput = {
  provider: "ollama" | "openai" | "gemini" | "anthropic";
  model: string;
  text: string;
  originalCharacterCount: number;
  truncated: boolean;
};

const defaultRawOutputLimit = 32_000;
const maximumRawOutputLimit = 256_000;

/** Shared, fail-open privacy boundary for all provider adapters. */
export function reportRawModelOutput(
  options: GenerationOptions | undefined,
  provider: RawModelOutput["provider"],
  model: string,
  text: string
) {
  const requested = options?.rawOutput;
  if (!requested?.enabled) return;
  const limit = Math.max(1, Math.min(requested.maxCharacters ?? defaultRawOutputLimit, maximumRawOutputLimit));
  const redacted = text
    .replace(/\b(?:sk|AIza)[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/\b(?:api[_-]?key|authorization|password|token)\s*[:=]\s*["']?[^\s,"'}\]]+/gi, "$1=[REDACTED]");
  try {
    requested.onOutput({
      provider,
      model,
      text: redacted.slice(0, limit),
      originalCharacterCount: text.length,
      truncated: redacted.length > limit
    });
  } catch { /* Diagnostics must never fail generation. */ }
}

const dynamicRequestStart = "<dynamic_request>";
const dynamicRequestEnd = "</dynamic_request>";

export function flattenGenerationInput(input: GenerationInput) {
  if (typeof input === "string") return input;
  if (!input.stablePrefix) return input.dynamicPrompt;
  return `${input.stablePrefix}\n\n${dynamicRequestStart}\n${input.dynamicPrompt}\n${dynamicRequestEnd}`;
}

export function isStructuredGenerationInput(input: GenerationInput): input is Exclude<GenerationInput, string> {
  return typeof input !== "string";
}

export interface LLMProvider {
  generate(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): Promise<string>;
  generateStream(input: GenerationInput, signal?: AbortSignal, options?: GenerationOptions): AsyncIterable<string>;
  generateJson<T>(prompt: string, signal?: AbortSignal, options?: GenerationOptions): Promise<T>;
  generateJsonObject<T>(prompt: string, signal?: AbortSignal, jsonSchema?: object, options?: GenerationOptions): Promise<T>;
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

export type LLMClaim = {
  subject: string;
  predicate: string;
  object: string;
  date: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  dateText: string | null;
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
  claims: LLMClaim[];
  summary: string;
};

export {
  buildAliasExtractionPrompt,
  buildClaimExtractionPrompt,
  buildEntityExtractionPrompt,
  buildRelationshipExtractionPrompt,
  buildSummaryExtractionPrompt
} from "./prompts.js";
export {
  OllamaEmbeddingProvider,
  OllamaProvider,
  checkOllamaHealth
} from "./providers/ollama.js";
export { OpenAIEmbeddingProvider, OpenAIProvider } from "./providers/openai.js";
export { GeminiEmbeddingProvider, GeminiProvider } from "./providers/gemini.js";
export { AnthropicProvider } from "./providers/anthropic.js";
