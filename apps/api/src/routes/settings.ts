import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApiConfig } from "../config/env.js";

type OllamaTagsResponse = {
  models?: Array<{ name?: string }>;
};

type ModelKind = "llm" | "embedding";
type Provider = "ollama" | "openai" | "gemini";
type CatalogModel = {
  name: string;
  kind: ModelKind;
  description: string;
  capabilities: string[];
  sizes: string[];
  pulls?: string;
  tags?: string;
  updated?: string;
};

const fallbackEmbeddingModels = [
  "all-minilm", "bge-large", "bge-m3", "embeddinggemma", "granite-embedding",
  "mxbai-embed-large", "nomic-embed-text", "nomic-embed-text-v2-moe",
  "qwen3-embedding", "snowflake-arctic-embed", "snowflake-arctic-embed2"
];

function textFromHtml(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function valuesFromModelCard(card: string, testAttribute: string) {
  return [...card.matchAll(new RegExp(`<span ${testAttribute}[^>]*>([\\s\\S]*?)<\\/span>`, "g"))]
    .map((match) => textFromHtml(match[1]));
}

function modelsFromLibraryHtml(html: string, kind: ModelKind): CatalogModel[] {
  return [...html.matchAll(/<li x-test-model[\s\S]*?<\/li>/g)].flatMap((match) => {
    const card = match[0];
    const name = card.match(/href="\/library\/([^"'#?\/]+)"/)?.[1];
    if (!name) return [];
    const description = card.match(/<p class="max-w-lg[^>]*>([\s\S]*?)<\/p>/)?.[1];
    return [{
      name: decodeURIComponent(name),
      kind,
      description: description ? textFromHtml(description) : "Ollama Library model",
      capabilities: valuesFromModelCard(card, "x-test-capability"),
      sizes: valuesFromModelCard(card, "x-test-size"),
      pulls: valuesFromModelCard(card, "x-test-pull-count")[0],
      tags: valuesFromModelCard(card, "x-test-tag-count")[0],
      updated: valuesFromModelCard(card, "x-test-updated")[0]
    }];
  });
}

async function getCatalog(): Promise<CatalogModel[]> {
  const [popularResponse, embeddingResponse] = await Promise.all([
    fetch("https://ollama.com/library?sort=popular"),
    fetch("https://ollama.com/library?q=embed")
  ]);
  if (!popularResponse.ok || !embeddingResponse.ok) {
    throw new Error("Ollama library could not be loaded.");
  }

  const popular = modelsFromLibraryHtml(await popularResponse.text(), "llm");
  const embeddingModels = modelsFromLibraryHtml(await embeddingResponse.text(), "embedding");
  const embeddings = new Set([...fallbackEmbeddingModels, ...embeddingModels.map((model) => model.name)]);
  const byName = new Map(popular.map((model) => [model.name, model]));
  for (const model of embeddingModels) byName.set(model.name, model);
  for (const name of fallbackEmbeddingModels) {
    if (!byName.has(name)) {
      byName.set(name, { name, kind: "embedding", description: "Ollama embedding model", capabilities: ["embedding"], sizes: [] });
    }
  }
  return [...byName.values()]
    .map((model) => ({ ...model, kind: embeddings.has(model.name) ? "embedding" as const : "llm" as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getInstalledModels(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama model list failed with ${response.status}`);
  }

  const body = (await response.json()) as OllamaTagsResponse;
  return (body.models ?? [])
    .map((model) => model.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
}

function settingsPath(config: ApiConfig) {
  return path.join(config.storageRoot, "settings", "models.json");
}

async function restoreSelectedModels(config: ApiConfig) {
  try {
    const saved = JSON.parse(await readFile(settingsPath(config), "utf8")) as {
      llmModel?: string;
      embeddingModel?: string; llmProvider?: Provider; embeddingProvider?: Provider; openaiApiKey?: string; geminiApiKey?: string;
    };
    if (saved.llmModel) config.ollamaLlmModel = saved.llmModel;
    if (saved.embeddingModel) config.ollamaEmbeddingModel = saved.embeddingModel;
    if (saved.llmProvider) config.llmProvider = saved.llmProvider;
    if (saved.embeddingProvider) config.embeddingProvider = saved.embeddingProvider;
    if (saved.openaiApiKey) config.openaiApiKey = saved.openaiApiKey;
    if (saved.geminiApiKey) config.geminiApiKey = saved.geminiApiKey;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function persistSelectedModels(config: ApiConfig) {
  const target = settingsPath(config);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ llmModel: config.ollamaLlmModel, embeddingModel: config.ollamaEmbeddingModel, llmProvider: config.llmProvider, embeddingProvider: config.embeddingProvider }, null, 2),
    "utf8"
  );
  await writeEnvironmentValues({
    LLM_PROVIDER: config.llmProvider,
    EMBEDDING_PROVIDER: config.embeddingProvider,
    OLLAMA_LLM_MODEL: config.ollamaLlmModel,
    OLLAMA_EMBEDDING_MODEL: config.ollamaEmbeddingModel,
    OPENAI_API_KEY: config.openaiApiKey,
    OPENAI_LLM_MODEL: config.openaiLlmModel,
    OPENAI_EMBEDDING_MODEL: config.openaiEmbeddingModel,
    GEMINI_API_KEY: config.geminiApiKey,
    GEMINI_LLM_MODEL: config.geminiLlmModel,
    GEMINI_EMBEDDING_MODEL: config.geminiEmbeddingModel
  });
}

async function writeEnvironmentValues(values: Record<string, string>) {
  const envPath = path.join(process.cwd(), ".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value.replace(/[\r\n]/g, "")}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  await writeFile(envPath, content, "utf8");
}

export async function registerSettingsRoutes(app: FastifyInstance, config: ApiConfig) {
  await restoreSelectedModels(config);

  app.get("/api/settings/models", async () => {
    const models = await getInstalledModels(config.ollamaBaseUrl);
    return {
      llmModel: config.ollamaLlmModel,
      embeddingModel: config.ollamaEmbeddingModel,
      llmProvider: config.llmProvider,
      embeddingProvider: config.embeddingProvider,
      openai: { configured: Boolean(config.openaiApiKey), llmModels: [config.openaiLlmModel, "gpt-4.1", "gpt-4.1-mini"], embeddingModels: [config.openaiEmbeddingModel, "text-embedding-3-small", "text-embedding-3-large"] },
      gemini: { configured: Boolean(config.geminiApiKey), llmModels: [config.geminiLlmModel, "gemini-2.5-flash", "gemini-2.5-pro"], embeddingModels: [config.geminiEmbeddingModel, "gemini-embedding-2", "gemini-embedding-001"] },
      models,
      catalog: await getCatalog()
    };
  });

  app.put<{
    Body: { llmModel?: string; embeddingModel?: string; llmProvider?: Provider; embeddingProvider?: Provider };
  }>("/api/settings/models", async (request, reply) => {
    const llmModel = request.body?.llmModel?.trim();
    const embeddingModel = request.body?.embeddingModel?.trim();
    const llmProvider = request.body?.llmProvider ?? "ollama";
    const embeddingProvider = request.body?.embeddingProvider ?? "ollama";
    if (!llmModel || !embeddingModel) {
      return reply.code(400).send({ message: "LLM and embedding models are required." });
    }

    if (!["ollama", "openai", "gemini"].includes(llmProvider) || !["ollama", "openai", "gemini"].includes(embeddingProvider)) return reply.code(400).send({ message: "Invalid AI provider." });
    if (llmProvider === "openai" && !config.openaiApiKey || embeddingProvider === "openai" && !config.openaiApiKey || llmProvider === "gemini" && !config.geminiApiKey || embeddingProvider === "gemini" && !config.geminiApiKey) return reply.code(400).send({ message: "The selected provider API key is not configured." });
    if (llmProvider === "ollama" || embeddingProvider === "ollama") {
      const installed = new Set(await getInstalledModels(config.ollamaBaseUrl));
      if ((llmProvider === "ollama" && !installed.has(llmModel)) || (embeddingProvider === "ollama" && !installed.has(embeddingModel))) return reply.code(400).send({ message: "Select installed Ollama models." });
    }

    config.llmProvider = llmProvider; config.embeddingProvider = embeddingProvider;
    if (llmProvider === "ollama") config.ollamaLlmModel = llmModel; else if (llmProvider === "openai") config.openaiLlmModel = llmModel; else config.geminiLlmModel = llmModel;
    if (embeddingProvider === "ollama") config.ollamaEmbeddingModel = embeddingModel; else if (embeddingProvider === "openai") config.openaiEmbeddingModel = embeddingModel; else config.geminiEmbeddingModel = embeddingModel;
    await persistSelectedModels(config);
    return { llmModel, embeddingModel };
  });

  app.post<{ Body: { model?: string } }>("/api/settings/models/pull", async (request, reply) => {
    const model = request.body?.model?.trim();
    if (!model) {
      return reply.code(400).send({ message: "A model name is required." });
    }

    const response = await fetch(`${config.ollamaBaseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model, stream: false })
    });
    if (!response.ok) {
      return reply.code(502).send({ message: `Ollama model download failed with ${response.status}.` });
    }

    return { model, models: await getInstalledModels(config.ollamaBaseUrl) };
  });

  app.put<{ Params: { provider: string }; Body: { apiKey?: string } }>("/api/settings/providers/:provider/key", async (request, reply) => {
    const apiKey = request.body?.apiKey?.trim();
    if (!apiKey) return reply.code(400).send({ message: "API key is required." });
    if (request.params.provider === "openai") config.openaiApiKey = apiKey;
    else if (request.params.provider === "gemini") config.geminiApiKey = apiKey;
    else return reply.code(400).send({ message: "Unsupported API key provider." });
    await persistSelectedModels(config);
    return { provider: request.params.provider, configured: true };
  });
}
