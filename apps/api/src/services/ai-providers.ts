import { AnthropicProvider, GeminiEmbeddingProvider, GeminiProvider, OllamaEmbeddingProvider, OllamaProvider, OpenAIEmbeddingProvider, OpenAIProvider, type EmbeddingProvider, type LLMProvider } from "@knowledgeos/ai";
import type { ApiConfig, LlmTemperatureProfile } from "../config/env.js";

function requireKey(key: string, provider: string) { if (!key) throw new Error(`${provider} API key is not configured.`); return key; }
function providerForSelection(config: ApiConfig, selection: string, temperature: number): LLMProvider {
  const [provider, ...parts] = selection.split("/");
  const model = parts.length ? parts.join("/") : selection;
  if (provider === "openai") return new OpenAIProvider(requireKey(config.openaiApiKey, "OpenAI"), model, temperature);
  if (provider === "anthropic") return new AnthropicProvider(requireKey(config.anthropicApiKey, "Anthropic"), model, temperature, config.anthropicBaseUrl);
  return new OllamaProvider(config.ollamaBaseUrl, model, config.ollamaLlmTimeoutMs, temperature, config.ollamaKeepAlive);
}
export function getLlmProvider(config: ApiConfig, profile?: LlmTemperatureProfile): LLMProvider {
  const temperature = profile ? config.llmTemperatures[profile] : config.llmTemperature;
  if (config.llmProvider === "openai") return new OpenAIProvider(requireKey(config.openaiApiKey, "OpenAI"), config.openaiLlmModel, temperature);
  if (config.llmProvider === "gemini") return new GeminiProvider(requireKey(config.geminiApiKey, "Gemini"), config.geminiLlmModel, temperature);
  if (config.llmProvider === "anthropic") return new AnthropicProvider(requireKey(config.anthropicApiKey, "Anthropic"), config.anthropicLlmModel, temperature, config.anthropicBaseUrl);
  return new OllamaProvider(config.ollamaBaseUrl, config.ollamaLlmModel, config.ollamaLlmTimeoutMs, temperature, config.ollamaKeepAlive);
}
export function getSmallLlmProvider(config: ApiConfig, role: "queryNormalizer" | "queryAnalyzer" | "ocrCorrector" | "conversationSummary" | "evidencePreparer" | "contradictionDetector" | "entityLinker" | "reranker"): LLMProvider {
  const selection = role === "queryNormalizer" ? config.queryNormalizerModel
    : role === "queryAnalyzer" ? config.queryAnalyzerModel
      : role === "ocrCorrector" ? config.ocrCorrectorModel
        : role === "conversationSummary" ? config.conversationSummaryModel
          : role === "evidencePreparer" ? config.evidencePreparerModel
            : role === "contradictionDetector" ? config.contradictionDetectorModel
              : role === "entityLinker" ? config.entityLinkerModel
                : config.rerankerModel;
  const temperature = role === "conversationSummary" ? config.llmTemperatures.summary : config.llmTemperatures.extraction;
  return providerForSelection(config, selection, temperature);
}
export function getMetadataLlmProvider(config: ApiConfig): LLMProvider {
  const selected = config.metadataLlmModel || config.ollamaLlmModel;
  return providerForSelection(config, selected, config.llmTemperatures.extraction);
}
export function getHybridApiProvider(config: ApiConfig): LLMProvider | null {
  const temperature = config.llmTemperatures.extraction;
  if (!config.hybridApiModel || config.hybridApiProvider === "none") return null;
  if (config.hybridApiProvider === "openai") return new OpenAIProvider(requireKey(config.openaiApiKey, "OpenAI"), config.hybridApiModel, temperature);
  if (config.hybridApiProvider === "gemini") return new GeminiProvider(requireKey(config.geminiApiKey, "Gemini"), config.hybridApiModel, temperature);
  return new AnthropicProvider(requireKey(config.anthropicApiKey, "Anthropic"), config.hybridApiModel, temperature, config.anthropicBaseUrl);
}
export function getEmbeddingProvider(config: ApiConfig): EmbeddingProvider {
  if (config.embeddingProvider === "openai") return new OpenAIEmbeddingProvider(requireKey(config.openaiApiKey, "OpenAI"), config.openaiEmbeddingModel);
  if (config.embeddingProvider === "gemini") return new GeminiEmbeddingProvider(requireKey(config.geminiApiKey, "Gemini"), config.geminiEmbeddingModel);
  return new OllamaEmbeddingProvider(config.ollamaBaseUrl, config.ollamaEmbeddingModel, config.ollamaEmbeddingTimeoutMs);
}
export function getFieldMatcherEmbeddingProvider(config: ApiConfig): EmbeddingProvider {
  const prefix = "openai/";
  if (config.fieldMatcherModel.startsWith(prefix)) return new OpenAIEmbeddingProvider(requireKey(config.openaiApiKey, "OpenAI"), config.fieldMatcherModel.slice(prefix.length));
  return new OllamaEmbeddingProvider(config.ollamaBaseUrl, config.fieldMatcherModel, config.ollamaEmbeddingTimeoutMs);
}
export function selectedEmbeddingModel(config: ApiConfig) { return config.embeddingProvider === "openai" ? `openai/${config.openaiEmbeddingModel}` : config.embeddingProvider === "gemini" ? `gemini/${config.geminiEmbeddingModel}` : `ollama/${config.ollamaEmbeddingModel}`; }
