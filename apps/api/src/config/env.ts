import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

export type LlmTemperatureProfile = "extraction" | "answer" | "summary" | "creative";
export type LlmTemperatures = Record<LlmTemperatureProfile, number>;
export type SmallModelRole = "entityLinker" | "reranker" | "fieldMatcher";

function temperature(value: string | undefined, fallback: number) {
  return Math.max(0, Math.min(2, Number(value ?? fallback)));
}

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function optionalSetting(value: string | undefined, fallback: string) {
  const normalized = (value ?? fallback).trim();
  return normalized && !["0", "false", "off", "none"].includes(normalized.toLowerCase()) ? normalized : null;
}

export function getEnvironmentPath() {
  const local = path.resolve(process.cwd(), ".env");
  if (existsSync(local)) return local;
  return path.resolve(process.cwd(), "../..", ".env");
}

dotenv.config({ path: getEnvironmentPath() });

export type ApiConfig = {
  databaseUrl: string;
  ollamaBaseUrl: string;
  ollamaLlmModel: string;
  ollamaLlmTimeoutMs: number;
  ollamaKeepAlive: string | null;
  ollamaEmbeddingTimeoutMs: number;
  llmTemperature: number;
  llmTemperatures: LlmTemperatures;
  ollamaEmbeddingModel: string;
  llmProvider: "ollama" | "openai" | "gemini" | "anthropic";
  embeddingProvider: "ollama" | "openai" | "gemini";
  openaiApiKey: string;
  openaiLlmModel: string;
  openaiEmbeddingModel: string;
  geminiApiKey: string;
  geminiLlmModel: string;
  geminiEmbeddingModel: string;
  anthropicApiKey: string;
  anthropicLlmModel: string;
  anthropicBaseUrl: string;
  entityLinkerModel: string;
  rerankerModel: string;
  fieldMatcherModel: string;
  llmContextCacheEnabled: boolean;
  llmContextCacheLogUsage: boolean;
  /** 0 selects an automatic model-aware RAG input budget. */
  ragSoftInputTokens: number;
  ragReservedOutputTokens: number;
  storageRoot: string;
  conversionRoot: string;
  apiHost: string;
  apiPort: number;
  environmentPath: string;
};

export function loadConfig(): ApiConfig {
  const llmProvider = (["openai", "gemini", "anthropic"] as const).includes(process.env.LLM_PROVIDER as "openai") ? process.env.LLM_PROVIDER as ApiConfig["llmProvider"] : "ollama";
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER === "openai" || process.env.EMBEDDING_PROVIDER === "gemini") ? process.env.EMBEDDING_PROVIDER : "ollama";
  const defaultLlmModel = llmProvider === "openai"
    ? process.env.OPENAI_LLM_MODEL ?? "gpt-4.1-mini"
    : llmProvider === "gemini"
      ? process.env.GEMINI_LLM_MODEL ?? "gemini-2.5-flash"
      : llmProvider === "anthropic"
        ? process.env.ANTHROPIC_LLM_MODEL ?? "claude-sonnet-4-20250514"
        : process.env.OLLAMA_LLM_MODEL ?? "qwen3:8b";
  const defaultEmbeddingModel = embeddingProvider === "openai"
    ? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
    : embeddingProvider === "gemini"
      ? process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2"
      : process.env.OLLAMA_EMBEDDING_MODEL ?? "bge-m3:latest";
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/knowledgeos",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaLlmModel: process.env.OLLAMA_LLM_MODEL ?? "qwen3:8b",
    ollamaLlmTimeoutMs: Number(process.env.OLLAMA_LLM_TIMEOUT_MS ?? 0),
    ollamaKeepAlive: optionalSetting(process.env.OLLAMA_KEEP_ALIVE, "5m"),
    // 0 disables the timeout. A cold local model can legitimately take a long time to load.
    ollamaEmbeddingTimeoutMs: Number(process.env.OLLAMA_EMBEDDING_TIMEOUT_MS ?? 0),
    llmTemperature: temperature(process.env.LLM_TEMPERATURE, 0.2),
    llmTemperatures: {
      extraction: temperature(process.env.LLM_TEMPERATURE_EXTRACTION, 0.1),
      answer: temperature(process.env.LLM_TEMPERATURE_ANSWER, 0.3),
      summary: temperature(process.env.LLM_TEMPERATURE_SUMMARY, 0.3),
      creative: temperature(process.env.LLM_TEMPERATURE_CREATIVE, 0.7)
    },
    ollamaEmbeddingModel:
      process.env.OLLAMA_EMBEDDING_MODEL ?? "bge-m3:latest",
    llmProvider,
    embeddingProvider,
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiLlmModel: process.env.OPENAI_LLM_MODEL ?? "gpt-4.1-mini",
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    geminiLlmModel: process.env.GEMINI_LLM_MODEL ?? "gemini-2.5-flash",
    geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicLlmModel: process.env.ANTHROPIC_LLM_MODEL ?? "claude-sonnet-4-20250514",
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    entityLinkerModel: process.env.SMALL_ENTITY_LINKER_MODEL ?? defaultLlmModel,
    rerankerModel: process.env.SMALL_RERANKER_MODEL ?? defaultLlmModel,
    fieldMatcherModel: process.env.SMALL_FIELD_MATCHER_MODEL ?? defaultEmbeddingModel,
    llmContextCacheEnabled: enabled(process.env.LLM_CONTEXT_CACHE_ENABLED, true),
    llmContextCacheLogUsage: enabled(process.env.LLM_CONTEXT_CACHE_LOG_USAGE, true),
    ragSoftInputTokens: Math.max(0, Number(process.env.RAG_SOFT_INPUT_TOKENS ?? 0)),
    ragReservedOutputTokens: Math.max(256, Number(process.env.RAG_RESERVED_OUTPUT_TOKENS ?? 1024)),
    storageRoot: process.env.STORAGE_ROOT ?? "./storage",
    conversionRoot: process.env.CONVERSION_ROOT ?? "./converted-markdown",
    apiHost: process.env.API_HOST ?? "127.0.0.1",
    apiPort: Number(process.env.API_PORT ?? 4000),
    environmentPath: getEnvironmentPath()
  };
}
