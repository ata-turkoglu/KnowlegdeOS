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
};

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
  generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T>;
  generateJsonObject<T>(prompt: string, signal?: AbortSignal, jsonSchema?: object): Promise<T>;
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

export { buildEntityExtractionPrompt } from "./prompts.js";
export {
  OllamaEmbeddingProvider,
  OllamaProvider,
  checkOllamaHealth
} from "./providers/ollama.js";
export { OpenAIEmbeddingProvider, OpenAIProvider } from "./providers/openai.js";
export { GeminiEmbeddingProvider, GeminiProvider } from "./providers/gemini.js";
export { AnthropicProvider } from "./providers/anthropic.js";
