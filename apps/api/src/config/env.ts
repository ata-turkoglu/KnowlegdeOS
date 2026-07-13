import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

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
  ollamaEmbeddingModel: string;
  llmProvider: "ollama" | "openai" | "gemini";
  embeddingProvider: "ollama" | "openai" | "gemini";
  openaiApiKey: string;
  openaiLlmModel: string;
  openaiEmbeddingModel: string;
  geminiApiKey: string;
  geminiLlmModel: string;
  geminiEmbeddingModel: string;
  storageRoot: string;
  apiHost: string;
  apiPort: number;
  environmentPath: string;
};

export function loadConfig(): ApiConfig {
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/knowledgeos",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaLlmModel: process.env.OLLAMA_LLM_MODEL ?? "qwen3:8b",
    ollamaLlmTimeoutMs: Number(process.env.OLLAMA_LLM_TIMEOUT_MS ?? 0),
    ollamaEmbeddingModel:
      process.env.OLLAMA_EMBEDDING_MODEL ?? "bge-m3:latest",
    llmProvider: (process.env.LLM_PROVIDER === "openai" || process.env.LLM_PROVIDER === "gemini") ? process.env.LLM_PROVIDER : "ollama",
    embeddingProvider: (process.env.EMBEDDING_PROVIDER === "openai" || process.env.EMBEDDING_PROVIDER === "gemini") ? process.env.EMBEDDING_PROVIDER : "ollama",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiLlmModel: process.env.OPENAI_LLM_MODEL ?? "gpt-4.1-mini",
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    geminiLlmModel: process.env.GEMINI_LLM_MODEL ?? "gemini-2.5-flash",
    geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
    storageRoot: process.env.STORAGE_ROOT ?? "./storage",
    apiHost: process.env.API_HOST ?? "127.0.0.1",
    apiPort: Number(process.env.API_PORT ?? 4000),
    environmentPath: getEnvironmentPath()
  };
}
