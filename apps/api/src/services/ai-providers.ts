import { GeminiEmbeddingProvider, GeminiProvider, OllamaEmbeddingProvider, OllamaProvider, OpenAIEmbeddingProvider, OpenAIProvider, type EmbeddingProvider, type LLMProvider } from "@knowledgeos/ai";
import type { ApiConfig } from "../config/env.js";

function requireKey(key: string, provider: string) { if (!key) throw new Error(`${provider} API key is not configured.`); return key; }
export function getLlmProvider(config: ApiConfig): LLMProvider {
  if (config.llmProvider === "openai") return new OpenAIProvider(requireKey(config.openaiApiKey, "OpenAI"), config.openaiLlmModel);
  if (config.llmProvider === "gemini") return new GeminiProvider(requireKey(config.geminiApiKey, "Gemini"), config.geminiLlmModel);
  return new OllamaProvider(config.ollamaBaseUrl, config.ollamaLlmModel, config.ollamaLlmTimeoutMs);
}
export function getEmbeddingProvider(config: ApiConfig): EmbeddingProvider {
  if (config.embeddingProvider === "openai") return new OpenAIEmbeddingProvider(requireKey(config.openaiApiKey, "OpenAI"), config.openaiEmbeddingModel);
  if (config.embeddingProvider === "gemini") return new GeminiEmbeddingProvider(requireKey(config.geminiApiKey, "Gemini"), config.geminiEmbeddingModel);
  return new OllamaEmbeddingProvider(config.ollamaBaseUrl, config.ollamaEmbeddingModel);
}
export function selectedEmbeddingModel(config: ApiConfig) { return config.embeddingProvider === "openai" ? `openai/${config.openaiEmbeddingModel}` : config.embeddingProvider === "gemini" ? `gemini/${config.geminiEmbeddingModel}` : `ollama/${config.ollamaEmbeddingModel}`; }
