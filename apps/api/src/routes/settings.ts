import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getEnvironmentPath, type ApiConfig, type LlmTemperatureProfile } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { getWorkspaceIngestionSettings, saveWorkspaceIngestionSettings, type WorkspaceIngestionSettings } from "../services/workspace-settings.js";
import { getWorkspaceYamlMetadataPrompt, saveWorkspaceYamlMetadataPrompt } from "../services/workspace-yaml-prompt.js";
import { getWorkspaceChatSystemPrompt, saveWorkspaceChatSystemPrompt } from "../services/workspace-chat-prompt.js";
import { getWorkspaceReindexStatus, reindexWorkspaceDocuments } from "../services/documents.js";
import { invalidateCapabilities, resolveModelCapabilities } from "../services/model-capabilities.js";
import { getSmallModelMetrics } from "../services/small-model-metrics.js";

type OllamaTagsResponse = {
  models?: Array<{ name?: string }>;
};

type ModelKind = "llm" | "embedding";
type Provider = "ollama" | "openai" | "gemini" | "anthropic";
type EmbeddingProvider = "ollama" | "openai" | "gemini";
const llmTemperatureProfiles: LlmTemperatureProfile[] = ["extraction", "answer", "summary", "creative"];
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

type WorkspaceReindexOperation = {
  status: "running" | "completed" | "cancelled" | "failed";
  completed: number;
  total: number;
  documentName?: string;
  error?: string;
  controller: AbortController;
};

const workspaceReindexOperations = new Map<string, WorkspaceReindexOperation>();
const activeWorkspaceReindexOperations = new Map<string, string>();
const operationRetentionMs = 15 * 60 * 1_000;

function completeWorkspaceReindexOperation(operationId: string, workspaceSlug: string) {
  activeWorkspaceReindexOperations.delete(workspaceSlug);
  setTimeout(() => workspaceReindexOperations.delete(operationId), operationRetentionMs);
}

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

async function getOpenAiModels(apiKey: string) {
  const fallback = { llmModels: ["gpt-4.1", "gpt-4.1-mini"], embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"] };
  if (!apiKey) return fallback;
  try {
    const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) return fallback;
    const body = await response.json() as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
    const embeddingModels = ids.filter((id) => id.startsWith("text-embedding-"));
    const llmModels = ids.filter((id) => /^(gpt|o[0-9])/.test(id) && !id.includes("realtime") && !id.includes("audio") && !id.includes("transcribe"));
    return { llmModels: llmModels.length ? llmModels.sort() : fallback.llmModels, embeddingModels: embeddingModels.length ? embeddingModels.sort() : fallback.embeddingModels };
  } catch {
    return fallback;
  }
}

async function getGeminiModels(apiKey: string) {
  const fallback = { llmModels: ["gemini-2.5-flash", "gemini-2.5-pro"], embeddingModels: ["gemini-embedding-2", "gemini-embedding-001"] };
  if (!apiKey) return fallback;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) return fallback;
    const body = await response.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const models = body.models ?? [];
    const namesFor = (method: string) => models.filter((model) => model.supportedGenerationMethods?.includes(method)).map((model) => model.name?.replace(/^models\//, "")).filter((name): name is string => Boolean(name)).sort();
    const llmModels = namesFor("generateContent");
    const embeddingModels = namesFor("embedContent");
    return { llmModels: llmModels.length ? llmModels : fallback.llmModels, embeddingModels: embeddingModels.length ? embeddingModels : fallback.embeddingModels };
  } catch {
    return fallback;
  }
}
async function getAnthropicModels(apiKey: string) {
  const fallback = ["claude-sonnet-4-20250514", "claude-opus-4-20250514"];
  if (!apiKey) return fallback;
  try { const response = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } }); if (!response.ok) return fallback; const body = await response.json() as { data?: Array<{ id?: string }> }; const models = (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)); return models.length ? models.sort() : fallback; } catch { return fallback; }
}

function settingsPath(config: ApiConfig) {
  return path.join(config.storageRoot, "settings", "models.json");
}

function activeLlmModel(config: ApiConfig) {
  return config.llmProvider === "openai" ? config.openaiLlmModel : config.llmProvider === "gemini" ? config.geminiLlmModel : config.llmProvider === "anthropic" ? config.anthropicLlmModel : config.ollamaLlmModel;
}

function activeEmbeddingModel(config: ApiConfig) {
  return config.embeddingProvider === "openai" ? config.openaiEmbeddingModel : config.embeddingProvider === "gemini" ? config.geminiEmbeddingModel : config.ollamaEmbeddingModel;
}

function modelLooksCompatible(provider: Provider, model: string) {
  if (provider === "openai") return /^(gpt|o\d)/i.test(model);
  if (provider === "gemini") return /^gemini-/i.test(model);
  if (provider === "anthropic") return /^claude-/i.test(model);
  return !/^(gpt|o\d|gemini-|claude-)/i.test(model);
}

async function restoreSelectedModels(config: ApiConfig) {
  try {
    const saved = JSON.parse(await readFile(settingsPath(config), "utf8")) as {
      llmModel?: string;
      embeddingModel?: string; llmProvider?: Provider; embeddingProvider?: EmbeddingProvider; openaiApiKey?: string; geminiApiKey?: string; anthropicApiKey?: string;
      llmTemperature?: number;
      llmTemperatures?: Partial<Record<LlmTemperatureProfile, number>>;
      ragSoftInputTokens?: number;
      ragReservedOutputTokens?: number;
      entityLinkerModel?: string;
      rerankerModel?: string;
      fieldMatcherModel?: string;
    };
    if (saved.llmProvider) config.llmProvider = saved.llmProvider;
    if (saved.embeddingProvider) config.embeddingProvider = saved.embeddingProvider;
    // Older settings files stored the Ollama model next to a cloud-provider
    // selection. Ignore impossible provider/model pairs and retain the provider's
    // configured default instead of making every chat request fail.
    if (saved.llmModel && modelLooksCompatible(config.llmProvider, saved.llmModel)) {
      if (config.llmProvider === "openai") config.openaiLlmModel = saved.llmModel;
      else if (config.llmProvider === "gemini") config.geminiLlmModel = saved.llmModel;
      else if (config.llmProvider === "anthropic") config.anthropicLlmModel = saved.llmModel;
      else config.ollamaLlmModel = saved.llmModel;
    }
    if (saved.embeddingModel) {
      if (config.embeddingProvider === "openai") config.openaiEmbeddingModel = saved.embeddingModel;
      else if (config.embeddingProvider === "gemini") config.geminiEmbeddingModel = saved.embeddingModel;
      else config.ollamaEmbeddingModel = saved.embeddingModel;
    }
    if (saved.openaiApiKey) config.openaiApiKey = saved.openaiApiKey;
    if (saved.geminiApiKey) config.geminiApiKey = saved.geminiApiKey;
    if (saved.anthropicApiKey) config.anthropicApiKey = saved.anthropicApiKey;
    if (typeof saved.ragSoftInputTokens === "number") config.ragSoftInputTokens = Math.max(0, saved.ragSoftInputTokens);
    if (typeof saved.ragReservedOutputTokens === "number") config.ragReservedOutputTokens = Math.max(256, saved.ragReservedOutputTokens);
    if (saved.entityLinkerModel) config.entityLinkerModel = saved.entityLinkerModel;
    if (saved.rerankerModel) config.rerankerModel = saved.rerankerModel;
    if (saved.fieldMatcherModel) config.fieldMatcherModel = saved.fieldMatcherModel;
    if (!saved.entityLinkerModel) config.entityLinkerModel = activeLlmModel(config);
    if (!saved.rerankerModel) config.rerankerModel = activeLlmModel(config);
    if (!saved.fieldMatcherModel) config.fieldMatcherModel = activeEmbeddingModel(config);
    if (typeof saved.llmTemperature === "number") config.llmTemperature = Math.max(0, Math.min(2, saved.llmTemperature));
    for (const profile of llmTemperatureProfiles) {
      const value = saved.llmTemperatures?.[profile];
      if (typeof value === "number") config.llmTemperatures[profile] = Math.max(0, Math.min(2, value));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function persistSelectedModels(config: ApiConfig) {
  const target = settingsPath(config);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ llmModel: activeLlmModel(config), embeddingModel: activeEmbeddingModel(config), llmProvider: config.llmProvider, embeddingProvider: config.embeddingProvider, entityLinkerModel: config.entityLinkerModel, rerankerModel: config.rerankerModel, fieldMatcherModel: config.fieldMatcherModel, llmTemperature: config.llmTemperature, llmTemperatures: config.llmTemperatures, ragSoftInputTokens: config.ragSoftInputTokens, ragReservedOutputTokens: config.ragReservedOutputTokens }, null, 2),
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
    GEMINI_EMBEDDING_MODEL: config.geminiEmbeddingModel,
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    ANTHROPIC_LLM_MODEL: config.anthropicLlmModel,
    ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
    SMALL_ENTITY_LINKER_MODEL: config.entityLinkerModel,
    SMALL_RERANKER_MODEL: config.rerankerModel,
    SMALL_FIELD_MATCHER_MODEL: config.fieldMatcherModel,
    RAG_SOFT_INPUT_TOKENS: String(config.ragSoftInputTokens),
    RAG_RESERVED_OUTPUT_TOKENS: String(config.ragReservedOutputTokens),
    LLM_TEMPERATURE: String(config.llmTemperature),
    LLM_TEMPERATURE_EXTRACTION: String(config.llmTemperatures.extraction),
    LLM_TEMPERATURE_ANSWER: String(config.llmTemperatures.answer),
    LLM_TEMPERATURE_SUMMARY: String(config.llmTemperatures.summary),
    LLM_TEMPERATURE_CREATIVE: String(config.llmTemperatures.creative)
  });
}

async function writeEnvironmentValues(values: Record<string, string>) {
  const envPath = getEnvironmentPath();
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
    const openaiModels = await getOpenAiModels(config.openaiApiKey);
    const geminiModels = await getGeminiModels(config.geminiApiKey);
    const anthropicModels = await getAnthropicModels(config.anthropicApiKey);
    const capabilities = await resolveModelCapabilities(config);
    return {
      llmModel: activeLlmModel(config),
      embeddingModel: activeEmbeddingModel(config),
      llmProvider: config.llmProvider,
      embeddingProvider: config.embeddingProvider,
      entityLinkerModel: config.entityLinkerModel,
      rerankerModel: config.rerankerModel,
      fieldMatcherModel: config.fieldMatcherModel,
      smallModelMetrics: getSmallModelMetrics(),
      llmTemperature: config.llmTemperature,
      llmTemperatures: config.llmTemperatures,
      ragSoftInputTokens: config.ragSoftInputTokens,
      ragReservedOutputTokens: config.ragReservedOutputTokens,
      capabilities,
      openai: { configured: Boolean(config.openaiApiKey), llmModels: [...new Set([config.openaiLlmModel, ...openaiModels.llmModels])], embeddingModels: [...new Set([config.openaiEmbeddingModel, ...openaiModels.embeddingModels])] },
      gemini: { configured: Boolean(config.geminiApiKey), llmModels: [...new Set([config.geminiLlmModel, ...geminiModels.llmModels])], embeddingModels: [...new Set([config.geminiEmbeddingModel, ...geminiModels.embeddingModels])] },
      anthropic: { configured: Boolean(config.anthropicApiKey), llmModels: [...new Set([config.anthropicLlmModel, ...anthropicModels])] },
      models,
      catalog: await getCatalog()
    };
  });

  app.put<{
    Body: { llmModel?: string; embeddingModel?: string; entityLinkerModel?: string; rerankerModel?: string; fieldMatcherModel?: string; llmProvider?: Provider; embeddingProvider?: EmbeddingProvider; llmTemperature?: number; llmTemperatures?: Partial<Record<LlmTemperatureProfile, number>>; ragSoftInputTokens?: number; ragReservedOutputTokens?: number };
  }>("/api/settings/models", async (request, reply) => {
    const llmModel = request.body?.llmModel?.trim();
    const embeddingModel = request.body?.embeddingModel?.trim();
    const entityLinkerModel = request.body?.entityLinkerModel?.trim();
    const rerankerModel = request.body?.rerankerModel?.trim();
    const fieldMatcherModel = request.body?.fieldMatcherModel?.trim();
    const llmProvider = request.body?.llmProvider ?? "ollama";
    const embeddingProvider = request.body?.embeddingProvider ?? "ollama";
    const llmTemperature = request.body?.llmTemperature ?? config.llmTemperature;
    const ragSoftInputTokens = request.body?.ragSoftInputTokens ?? config.ragSoftInputTokens;
    const ragReservedOutputTokens = request.body?.ragReservedOutputTokens ?? config.ragReservedOutputTokens;
    const llmTemperatures = { ...config.llmTemperatures };
    for (const profile of llmTemperatureProfiles) {
      const value = request.body?.llmTemperatures?.[profile];
      if (value !== undefined) llmTemperatures[profile] = value;
    }
    if (!llmModel || !embeddingModel || !entityLinkerModel || !rerankerModel || !fieldMatcherModel) {
      return reply.code(400).send({ message: "All primary and small-task models are required." });
    }

    if (!["ollama", "openai", "gemini", "anthropic"].includes(llmProvider) || !["ollama", "openai", "gemini"].includes(embeddingProvider)) return reply.code(400).send({ message: "Invalid AI provider." });
    if (![llmTemperature, ...Object.values(llmTemperatures)].every((value) => Number.isFinite(value) && value >= 0 && value <= 2)) return reply.code(400).send({ message: "Temperature must be between 0 and 2." });
    if (!Number.isInteger(ragSoftInputTokens) || ragSoftInputTokens < 0 || !Number.isInteger(ragReservedOutputTokens) || ragReservedOutputTokens < 256) return reply.code(400).send({ message: "RAG token budgets are invalid." });
    if (llmProvider === "openai" && !config.openaiApiKey || embeddingProvider === "openai" && !config.openaiApiKey || llmProvider === "gemini" && !config.geminiApiKey || embeddingProvider === "gemini" && !config.geminiApiKey || llmProvider === "anthropic" && !config.anthropicApiKey) return reply.code(400).send({ message: "The selected provider API key is not configured." });
    if (llmProvider === "ollama" || embeddingProvider === "ollama") {
      const installed = new Set(await getInstalledModels(config.ollamaBaseUrl));
      if ((llmProvider === "ollama" && (![llmModel, entityLinkerModel, rerankerModel].every((model) => installed.has(model)))) || (embeddingProvider === "ollama" && ![embeddingModel, fieldMatcherModel].every((model) => installed.has(model)))) return reply.code(400).send({ message: "Select installed Ollama models." });
    }

    config.llmProvider = llmProvider; config.embeddingProvider = embeddingProvider;
    config.llmTemperature = llmTemperature;
    config.llmTemperatures = llmTemperatures;
    config.ragSoftInputTokens = ragSoftInputTokens;
    config.ragReservedOutputTokens = ragReservedOutputTokens;
    config.entityLinkerModel = entityLinkerModel;
    config.rerankerModel = rerankerModel;
    config.fieldMatcherModel = fieldMatcherModel;
    if (llmProvider === "ollama") config.ollamaLlmModel = llmModel; else if (llmProvider === "openai") config.openaiLlmModel = llmModel; else if (llmProvider === "gemini") config.geminiLlmModel = llmModel; else config.anthropicLlmModel = llmModel;
    if (embeddingProvider === "ollama") config.ollamaEmbeddingModel = embeddingModel; else if (embeddingProvider === "openai") config.openaiEmbeddingModel = embeddingModel; else config.geminiEmbeddingModel = embeddingModel;
    invalidateCapabilities();
    await persistSelectedModels(config);
    return { llmModel, embeddingModel, entityLinkerModel, rerankerModel, fieldMatcherModel, llmTemperature, llmTemperatures, ragSoftInputTokens, ragReservedOutputTokens, capabilities: await resolveModelCapabilities(config, true) };
  });

  app.post("/api/settings/model-capabilities/refresh", async () => {
    invalidateCapabilities();
    return { capabilities: await resolveModelCapabilities(config, true) };
  });

  app.get<{ Params: { workspaceSlug: string } }>("/api/settings/ingestion/:workspaceSlug", async (request) => ({
    workspaceSlug: request.params.workspaceSlug,
    settings: await getWorkspaceIngestionSettings(config, request.params.workspaceSlug),
    reindex: await getWorkspaceReindexStatus(config, request.params.workspaceSlug)
  }));

  app.put<{ Params: { workspaceSlug: string }; Body: Partial<WorkspaceIngestionSettings> }>("/api/settings/ingestion/:workspaceSlug", async (request) => ({
    workspaceSlug: request.params.workspaceSlug,
    settings: await saveWorkspaceIngestionSettings(config, request.params.workspaceSlug, request.body ?? {}),
    reindex: await getWorkspaceReindexStatus(config, request.params.workspaceSlug)
  }));

  app.get<{ Params: { workspaceSlug: string } }>("/api/settings/yaml-metadata-prompt/:workspaceSlug", async (request) => ({
    workspaceSlug: request.params.workspaceSlug,
    prompt: await getWorkspaceYamlMetadataPrompt(config, request.params.workspaceSlug)
  }));

  app.put<{ Params: { workspaceSlug: string }; Body: { prompt?: unknown } }>("/api/settings/yaml-metadata-prompt/:workspaceSlug", async (request, reply) => {
    try {
      return { workspaceSlug: request.params.workspaceSlug, prompt: await saveWorkspaceYamlMetadataPrompt(config, request.params.workspaceSlug, request.body?.prompt) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "YAML metadata prompt could not be saved." });
    }
  });
  app.get<{ Params: { workspaceSlug: string } }>("/api/settings/chat-system-prompt/:workspaceSlug", async (request) => ({ workspaceSlug: request.params.workspaceSlug, prompt: await getWorkspaceChatSystemPrompt(config, request.params.workspaceSlug) }));
  app.put<{ Params: { workspaceSlug: string }; Body: { prompt?: unknown } }>("/api/settings/chat-system-prompt/:workspaceSlug", async (request, reply) => {
    try { return { workspaceSlug: request.params.workspaceSlug, prompt: await saveWorkspaceChatSystemPrompt(config, request.params.workspaceSlug, request.body?.prompt) }; }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Chat system prompt could not be saved." }); }
  });

  app.post<{ Params: { workspaceSlug: string }; Body: { useLlm?: boolean } }>("/api/settings/ingestion/:workspaceSlug/reindex", async (request, reply) => {
    const workspaceSlug = slugify(request.params.workspaceSlug || "merter-arsivi");
    const activeOperationId = activeWorkspaceReindexOperations.get(workspaceSlug);
    if (activeOperationId) {
      const activeOperation = workspaceReindexOperations.get(activeOperationId);
      if (activeOperation?.status === "running") {
        return reply.code(409).send({ error: "A reindex operation is already running for this workspace.", operationId: activeOperationId });
      }
      activeWorkspaceReindexOperations.delete(workspaceSlug);
    }
    const operationId = randomUUID();
    const controller = new AbortController();
    const operation: WorkspaceReindexOperation = { status: "running", completed: 0, total: 0, controller };
    workspaceReindexOperations.set(operationId, operation);
    activeWorkspaceReindexOperations.set(workspaceSlug, operationId);
    void reindexWorkspaceDocuments(config, workspaceSlug, {
      signal: controller.signal,
      useLlm: request.body?.useLlm === true,
      onProgress: (progress) => Object.assign(operation, progress)
    }).then(() => {
      operation.status = "completed";
      operation.completed = operation.total;
      completeWorkspaceReindexOperation(operationId, workspaceSlug);
    }).catch((error) => {
      operation.status = controller.signal.aborted ? "cancelled" : "failed";
      operation.error = error instanceof Error ? error.message : "Reindexing failed.";
      completeWorkspaceReindexOperation(operationId, workspaceSlug);
    });
    return { operationId };
  });

  app.get<{ Params: { operationId: string } }>("/api/settings/ingestion/reindex-operations/:operationId", async (request, reply) => {
    const operation = workspaceReindexOperations.get(request.params.operationId);
    if (!operation) return reply.code(404).send({ error: "Reindex operation was not found." });
    return { status: operation.status, completed: operation.completed, total: operation.total, documentName: operation.documentName, error: operation.error };
  });

  app.delete<{ Params: { operationId: string } }>("/api/settings/ingestion/reindex-operations/:operationId", async (request, reply) => {
    const operation = workspaceReindexOperations.get(request.params.operationId);
    if (!operation) return reply.code(404).send({ error: "Reindex operation was not found." });
    if (operation.status === "running") operation.controller.abort();
    return { status: operation.status };
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
    else if (request.params.provider === "anthropic") config.anthropicApiKey = apiKey;
    else return reply.code(400).send({ message: "Unsupported API key provider." });
    invalidateCapabilities();
    await persistSelectedModels(config);
    return { provider: request.params.provider, configured: true };
  });
}
