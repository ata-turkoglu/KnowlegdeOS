export interface LLMProvider {
  generate(prompt: string, signal?: AbortSignal, options?: { maxOutputTokens?: number }): Promise<string>;
  generateStream(prompt: string, signal?: AbortSignal, options?: { maxOutputTokens?: number }): AsyncIterable<string>;
  generateJson<T>(prompt: string, signal?: AbortSignal): Promise<T>;
  generateJsonObject<T>(prompt: string, signal?: AbortSignal): Promise<T>;
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
