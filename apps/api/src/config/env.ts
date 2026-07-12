import "dotenv/config";

export type ApiConfig = {
  databaseUrl: string;
  ollamaBaseUrl: string;
  ollamaLlmModel: string;
  ollamaEmbeddingModel: string;
  storageRoot: string;
  apiHost: string;
  apiPort: number;
};

export function loadConfig(): ApiConfig {
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/knowledgeos",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaLlmModel: process.env.OLLAMA_LLM_MODEL ?? "qwen3:8b",
    ollamaEmbeddingModel:
      process.env.OLLAMA_EMBEDDING_MODEL ?? "bge-m3:latest",
    storageRoot: process.env.STORAGE_ROOT ?? "./storage",
    apiHost: process.env.API_HOST ?? "127.0.0.1",
    apiPort: Number(process.env.API_PORT ?? 4000)
  };
}
