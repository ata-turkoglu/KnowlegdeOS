import { AnthropicProvider, GeminiEmbeddingProvider, GeminiProvider, OllamaEmbeddingProvider, OllamaProvider, OpenAIEmbeddingProvider, OpenAIProvider, type EmbeddingProvider, type LLMProvider } from "@knowledgeos/ai";
import type { ApiConfig, LlmTemperatureProfile } from "../config/env.js";

function requireKey(key: string, provider: string) { if (!key) throw new Error(`${provider} API key is not configured.`); return key; }
export function getLlmProvider(config: ApiConfig, profile?: LlmTemperatureProfile): LLMProvider {
  const temperature = profile ? config.llmTemperatures[profile] : config.llmTemperature;
  if (config.llmProvider === "openai") return new OpenAIProvider(requireKey(config.openaiApiKey, "OpenAI"), config.openaiLlmModel, temperature);
  if (config.llmProvider === "gemini") return new GeminiProvider(requireKey(config.geminiApiKey, "Gemini"), config.geminiLlmModel, temperature);
  if (config.llmProvider === "anthropic") return new AnthropicProvider(requireKey(config.anthropicApiKey, "Anthropic"), config.anthropicLlmModel, temperature, config.anthropicBaseUrl);
  return new OllamaProvider(config.ollamaBaseUrl, config.ollamaLlmModel, config.ollamaLlmTimeoutMs, temperature, config.ollamaKeepAlive);
}
export function getSmallLlmProvider(config: ApiConfig, role: "entityLinker" | "reranker"): LLMProvider {
  const model = role === "entityLinker" ? config.entityLinkerModel : config.rerankerModel;
  const temperature = config.llmTemperatures.extraction;
  if (config.llmProvider === "openai") return new OpenAIProvider(requireKey(config.openaiApiKey, "OpenAI"), model, temperature);
  if (config.llmProvider === "gemini") return new GeminiProvider(requireKey(config.geminiApiKey, "Gemini"), model, temperature);
  if (config.llmProvider === "anthropic") return new AnthropicProvider(requireKey(config.anthropicApiKey, "Anthropic"), model, temperature, config.anthropicBaseUrl);
  return new OllamaProvider(config.ollamaBaseUrl, model, config.ollamaLlmTimeoutMs, temperature, config.ollamaKeepAlive);
}
export function getEmbeddingProvider(config: ApiConfig): EmbeddingProvider {
  if (config.embeddingProvider === "openai") return new OpenAIEmbeddingProvider(requireKey(config.openaiApiKey, "OpenAI"), config.openaiEmbeddingModel);
  if (config.embeddingProvider === "gemini") return new GeminiEmbeddingProvider(requireKey(config.geminiApiKey, "Gemini"), config.geminiEmbeddingModel);
  return new OllamaEmbeddingProvider(config.ollamaBaseUrl, config.ollamaEmbeddingModel, config.ollamaEmbeddingTimeoutMs);
}
export function getFieldMatcherEmbeddingProvider(config: ApiConfig): EmbeddingProvider {
  if (config.embeddingProvider === "openai") return new OpenAIEmbeddingProvider(requireKey(config.openaiApiKey, "OpenAI"), config.fieldMatcherModel);
  if (config.embeddingProvider === "gemini") return new GeminiEmbeddingProvider(requireKey(config.geminiApiKey, "Gemini"), config.fieldMatcherModel);
  return new OllamaEmbeddingProvider(config.ollamaBaseUrl, config.fieldMatcherModel, config.ollamaEmbeddingTimeoutMs);
}
export function selectedEmbeddingModel(config: ApiConfig) { return config.embeddingProvider === "openai" ? `openai/${config.openaiEmbeddingModel}` : config.embeddingProvider === "gemini" ? `gemini/${config.geminiEmbeddingModel}` : `ollama/${config.ollamaEmbeddingModel}`; }
