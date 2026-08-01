import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getEnvironmentPath, type ApiConfig, type ApiRerankerProvider, type LlmTemperatureProfile } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { getWorkspaceIngestionSettings, saveWorkspaceIngestionSettings, type WorkspaceIngestionSettings } from "../services/workspace-settings.js";
import { getWorkspaceYamlMetadataPrompt, saveWorkspaceYamlMetadataPrompt } from "../services/workspace-yaml-prompt.js";
import { getWorkspaceChatSystemPrompt, saveWorkspaceChatSystemPrompt } from "../services/workspace-chat-prompt.js";
import { getWorkspaceReindexStatus, reindexWorkspaceDocuments } from "../services/documents.js";
import { invalidateCapabilities, resolveModelCapabilities } from "../services/model-capabilities.js";
import { getSmallModelMetrics } from "../services/small-model-metrics.js";
import { getHardwareProfile } from "../services/hardware-profile.js";

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

type ModelPullOperation = { status: "running" | "completed" | "failed"; model: string; completed: number; total: number; startedAt: number; error?: string };

const workspaceReindexOperations = new Map<string, WorkspaceReindexOperation>();
const modelPullOperations = new Map<string, ModelPullOperation>();
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

const fallbackLlmModels = [
  "qwen3:1.7b", "qwen3:4b", "qwen3:8b", "qwen3:14b",
  "llama3.2:1b", "llama3.2:3b", "mistral:7b", "gemma3:1b", "gemma3:4b",
  "deepseek-r1:7b", "phi4:14b"
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
  for (const name of fallbackLlmModels) {
    if (!byName.has(name)) {
      byName.set(name, { name, kind: "llm", description: "Ollama language model", capabilities: ["chat"], sizes: [] });
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

function smallModelSelection(value: string) {
  const [provider, ...parts] = value.split("/");
  if (parts.length && (provider === "openai" || provider === "anthropic")) return { provider, model: parts.join("/") } as const;
  return { provider: "ollama" as const, model: value };
}

async function restoreSelectedModels(config: ApiConfig) {
  try {
    const saved = JSON.parse(await readFile(settingsPath(config), "utf8")) as {
      llmModel?: string;
      metadataLlmModel?: string;
      embeddingModel?: string; llmProvider?: Provider; embeddingProvider?: EmbeddingProvider; openaiApiKey?: string; geminiApiKey?: string; anthropicApiKey?: string;
      llmTemperature?: number;
      llmTemperatures?: Partial<Record<LlmTemperatureProfile, number>>;
      ragSoftInputTokens?: number;
      ragReservedOutputTokens?: number;
      entityLinkerModel?: string;
      rerankerModel?: string;
      queryNormalizerModel?: string;
      queryAnalyzerModel?: string;
      ocrCorrectorModel?: string;
      conversationSummaryModel?: string;
      evidencePreparerModel?: string;
      contradictionDetectorModel?: string;
      fieldMatcherModel?: string;
      apiRerankerProvider?: ApiRerankerProvider;
      apiRerankerModel?: string;
      /** @deprecated Backward-compatible read for pre-rename settings. */
      hybridApiProvider?: ApiRerankerProvider;
      /** @deprecated Backward-compatible read for pre-rename settings. */
      hybridApiModel?: string;
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
    if (saved.queryNormalizerModel) config.queryNormalizerModel = saved.queryNormalizerModel;
    if (saved.queryAnalyzerModel) config.queryAnalyzerModel = saved.queryAnalyzerModel;
    if (saved.ocrCorrectorModel) config.ocrCorrectorModel = saved.ocrCorrectorModel;
    if (saved.conversationSummaryModel) config.conversationSummaryModel = saved.conversationSummaryModel;
    if (saved.evidencePreparerModel) config.evidencePreparerModel = saved.evidencePreparerModel;
    if (saved.contradictionDetectorModel) config.contradictionDetectorModel = saved.contradictionDetectorModel;
    if (saved.metadataLlmModel) config.metadataLlmModel = saved.metadataLlmModel;
    if (saved.fieldMatcherModel) config.fieldMatcherModel = saved.embeddingProvider === "openai" && !saved.fieldMatcherModel.includes("/") ? `openai/${saved.fieldMatcherModel}` : saved.fieldMatcherModel;
    const savedApiProvider = saved.apiRerankerProvider ?? saved.hybridApiProvider;
    const savedApiModel = saved.apiRerankerModel ?? saved.hybridApiModel;
    if (savedApiProvider && ["none", "openai", "gemini", "anthropic"].includes(savedApiProvider)) config.apiRerankerProvider = savedApiProvider;
    if (savedApiModel) config.apiRerankerModel = savedApiModel;
    // Reranking has two intentionally separate lanes.  Older settings used one
    // model field for both and could therefore make the "local" lane call an
    // API. Keep the explicit hybrid settings and migrate a legacy API-valued
    // local reranker back to Ollama.
    if (smallModelSelection(config.rerankerModel).provider !== "ollama") {
      config.rerankerModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    }
    if (!saved.entityLinkerModel) config.entityLinkerModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.rerankerModel) config.rerankerModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.queryNormalizerModel) config.queryNormalizerModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.queryAnalyzerModel) config.queryAnalyzerModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.ocrCorrectorModel) config.ocrCorrectorModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.conversationSummaryModel) config.conversationSummaryModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.evidencePreparerModel) config.evidencePreparerModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.contradictionDetectorModel) config.contradictionDetectorModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    if (!saved.metadataLlmModel) config.metadataLlmModel = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
    // Before hybrid routing, these roles could inherit the cloud answer model.
    // Replace that legacy selection with the local default on first startup.
    if (config.llmProvider !== "ollama" && saved.llmModel) {
      const localDefault = process.env.OLLAMA_LLM_MODEL ?? "qwen3:4b";
      if (config.entityLinkerModel === saved.llmModel) config.entityLinkerModel = localDefault;
      if (config.rerankerModel === saved.llmModel) config.rerankerModel = localDefault;
    }
    if (!saved.fieldMatcherModel) config.fieldMatcherModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "bge-m3:latest";
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
    JSON.stringify({ llmModel: activeLlmModel(config), metadataLlmModel: config.metadataLlmModel, embeddingModel: activeEmbeddingModel(config), llmProvider: config.llmProvider, embeddingProvider: config.embeddingProvider, queryNormalizerModel: config.queryNormalizerModel, queryAnalyzerModel: config.queryAnalyzerModel, ocrCorrectorModel: config.ocrCorrectorModel, conversationSummaryModel: config.conversationSummaryModel, evidencePreparerModel: config.evidencePreparerModel, contradictionDetectorModel: config.contradictionDetectorModel, entityLinkerModel: config.entityLinkerModel, rerankerModel: config.rerankerModel, fieldMatcherModel: config.fieldMatcherModel, apiRerankerProvider: config.apiRerankerProvider, apiRerankerModel: config.apiRerankerModel, llmTemperature: config.llmTemperature, llmTemperatures: config.llmTemperatures, ragSoftInputTokens: config.ragSoftInputTokens, ragReservedOutputTokens: config.ragReservedOutputTokens }, null, 2),
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
    METADATA_LLM_MODEL: config.metadataLlmModel,
    GEMINI_API_KEY: config.geminiApiKey,
    GEMINI_LLM_MODEL: config.geminiLlmModel,
    GEMINI_EMBEDDING_MODEL: config.geminiEmbeddingModel,
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    ANTHROPIC_LLM_MODEL: config.anthropicLlmModel,
    ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
    SMALL_ENTITY_LINKER_MODEL: config.entityLinkerModel,
    SMALL_RERANKER_MODEL: config.rerankerModel,
    SMALL_QUERY_NORMALIZER_MODEL: config.queryNormalizerModel,
    SMALL_QUERY_ANALYZER_MODEL: config.queryAnalyzerModel,
    SMALL_OCR_CORRECTOR_MODEL: config.ocrCorrectorModel,
    SMALL_CONVERSATION_SUMMARY_MODEL: config.conversationSummaryModel,
    SMALL_EVIDENCE_PREPARER_MODEL: config.evidencePreparerModel,
    SMALL_CONTRADICTION_DETECTOR_MODEL: config.contradictionDetectorModel,
    SMALL_FIELD_MATCHER_MODEL: config.fieldMatcherModel,
    RERANKER_API_PROVIDER: config.apiRerankerProvider,
    RERANKER_API_MODEL: config.apiRerankerModel,
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
    const [capabilities, hardwareProfile] = await Promise.all([resolveModelCapabilities(config), getHardwareProfile()]);
    return {
      llmModel: activeLlmModel(config),
      metadataLlmModel: config.metadataLlmModel,
      embeddingModel: activeEmbeddingModel(config),
      llmProvider: config.llmProvider,
      embeddingProvider: config.embeddingProvider,
      entityLinkerModel: config.entityLinkerModel,
      rerankerModel: config.rerankerModel,
      queryNormalizerModel: config.queryNormalizerModel,
      queryAnalyzerModel: config.queryAnalyzerModel,
      ocrCorrectorModel: config.ocrCorrectorModel,
      conversationSummaryModel: config.conversationSummaryModel,
      evidencePreparerModel: config.evidencePreparerModel,
      contradictionDetectorModel: config.contradictionDetectorModel,
      fieldMatcherModel: config.fieldMatcherModel,
      apiRerankerProvider: config.apiRerankerProvider,
      apiRerankerModel: config.apiRerankerModel,
      smallModelMetrics: getSmallModelMetrics(),
      llmTemperature: config.llmTemperature,
      llmTemperatures: config.llmTemperatures,
      ragSoftInputTokens: config.ragSoftInputTokens,
      ragReservedOutputTokens: config.ragReservedOutputTokens,
      capabilities,
      hardwareProfile,
      openai: { configured: Boolean(config.openaiApiKey), llmModels: [...new Set([config.openaiLlmModel, ...openaiModels.llmModels])], embeddingModels: [...new Set([config.openaiEmbeddingModel, ...openaiModels.embeddingModels])] },
      gemini: { configured: Boolean(config.geminiApiKey), llmModels: [...new Set([config.geminiLlmModel, ...geminiModels.llmModels])], embeddingModels: [...new Set([config.geminiEmbeddingModel, ...geminiModels.embeddingModels])] },
      anthropic: { configured: Boolean(config.anthropicApiKey), llmModels: [...new Set([config.anthropicLlmModel, ...anthropicModels])] },
      models,
      catalog: await getCatalog()
    };
  });

  app.put<{
    Body: { llmModel?: string; metadataLlmModel?: string; embeddingModel?: string; queryNormalizerModel?: string; queryAnalyzerModel?: string; ocrCorrectorModel?: string; conversationSummaryModel?: string; evidencePreparerModel?: string; contradictionDetectorModel?: string; entityLinkerModel?: string; rerankerModel?: string; fieldMatcherModel?: string; apiRerankerProvider?: ApiRerankerProvider; apiRerankerModel?: string; llmProvider?: Provider; embeddingProvider?: EmbeddingProvider; llmTemperature?: number; llmTemperatures?: Partial<Record<LlmTemperatureProfile, number>>; ragSoftInputTokens?: number; ragReservedOutputTokens?: number };
  }>("/api/settings/models", async (request, reply) => {
    const llmModel = request.body?.llmModel?.trim();
    const metadataLlmModel = request.body?.metadataLlmModel?.trim();
    const embeddingModel = request.body?.embeddingModel?.trim();
    const entityLinkerModel = request.body?.entityLinkerModel?.trim();
    const rerankerModel = request.body?.rerankerModel?.trim();
    const queryNormalizerModel = request.body?.queryNormalizerModel?.trim();
    const queryAnalyzerModel = request.body?.queryAnalyzerModel?.trim();
    const ocrCorrectorModel = request.body?.ocrCorrectorModel?.trim();
    const conversationSummaryModel = request.body?.conversationSummaryModel?.trim();
    const evidencePreparerModel = request.body?.evidencePreparerModel?.trim();
    const contradictionDetectorModel = request.body?.contradictionDetectorModel?.trim();
    const fieldMatcherModel = request.body?.fieldMatcherModel?.trim();
    const llmProvider = request.body?.llmProvider ?? "ollama";
    const apiRerankerProvider = request.body?.apiRerankerProvider ?? config.apiRerankerProvider;
    const apiRerankerModel = request.body?.apiRerankerModel?.trim() ?? config.apiRerankerModel;
    const embeddingProvider = request.body?.embeddingProvider ?? "ollama";
    const llmTemperature = request.body?.llmTemperature ?? config.llmTemperature;
    const ragSoftInputTokens = request.body?.ragSoftInputTokens ?? config.ragSoftInputTokens;
    const ragReservedOutputTokens = request.body?.ragReservedOutputTokens ?? config.ragReservedOutputTokens;
    const llmTemperatures = { ...config.llmTemperatures };
    for (const profile of llmTemperatureProfiles) {
      const value = request.body?.llmTemperatures?.[profile];
      if (value !== undefined) llmTemperatures[profile] = value;
    }
    if (!llmModel || !metadataLlmModel || !embeddingModel || !queryNormalizerModel || !queryAnalyzerModel || !ocrCorrectorModel || !conversationSummaryModel || !evidencePreparerModel || !contradictionDetectorModel || !entityLinkerModel || !rerankerModel || !fieldMatcherModel) {
      return reply.code(400).send({ message: "All primary and small-task models are required." });
    }

    if (smallModelSelection(rerankerModel).provider !== "ollama") return reply.code(400).send({ message: "The local reranker must use an installed Ollama model." });
    if (!["none", "openai", "gemini", "anthropic"].includes(apiRerankerProvider)) return reply.code(400).send({ message: "Invalid API reranker provider." });
    if (apiRerankerProvider !== "none" && !apiRerankerModel) return reply.code(400).send({ message: "Select an API reranker model." });
    if (apiRerankerProvider === "openai" && (!config.openaiApiKey || !modelLooksCompatible("openai", apiRerankerModel)) || apiRerankerProvider === "gemini" && (!config.geminiApiKey || !modelLooksCompatible("gemini", apiRerankerModel)) || apiRerankerProvider === "anthropic" && (!config.anthropicApiKey || !modelLooksCompatible("anthropic", apiRerankerModel))) return reply.code(400).send({ message: "The API reranker provider or model is not configured." });

    if (!["ollama", "openai", "gemini", "anthropic"].includes(llmProvider) || !["ollama", "openai", "gemini"].includes(embeddingProvider)) return reply.code(400).send({ message: "Invalid AI provider." });
    if (![llmTemperature, ...Object.values(llmTemperatures)].every((value) => Number.isFinite(value) && value >= 0 && value <= 2)) return reply.code(400).send({ message: "Temperature must be between 0 and 2." });
    if (!Number.isInteger(ragSoftInputTokens) || ragSoftInputTokens < 0 || !Number.isInteger(ragReservedOutputTokens) || ragReservedOutputTokens < 256) return reply.code(400).send({ message: "RAG token budgets are invalid." });
    if (llmProvider === "openai" && !config.openaiApiKey || embeddingProvider === "openai" && !config.openaiApiKey || llmProvider === "gemini" && !config.geminiApiKey || embeddingProvider === "gemini" && !config.geminiApiKey || llmProvider === "anthropic" && !config.anthropicApiKey) return reply.code(400).send({ message: "The selected provider API key is not configured." });
    const smallModels = [metadataLlmModel, queryNormalizerModel, queryAnalyzerModel, ocrCorrectorModel, conversationSummaryModel, evidencePreparerModel, contradictionDetectorModel, entityLinkerModel, rerankerModel].map(smallModelSelection);
    const fieldMatcherSelection = fieldMatcherModel.startsWith("openai/") ? { provider: "openai" as const, model: fieldMatcherModel.slice("openai/".length) } : { provider: "ollama" as const, model: fieldMatcherModel };
    if (smallModels.some(({ provider, model }) => provider !== "ollama" && !modelLooksCompatible(provider, model))) return reply.code(400).send({ message: "Small-task model provider/model pairs are invalid." });
    if (smallModels.some(({ provider }) => provider === "openai") && !config.openaiApiKey || smallModels.some(({ provider }) => provider === "anthropic") && !config.anthropicApiKey) return reply.code(400).send({ message: "The selected small-task API provider key is not configured." });
    if (fieldMatcherSelection.provider === "openai" && !config.openaiApiKey) return reply.code(400).send({ message: "The field matcher OpenAI key is not configured." });
    if (llmProvider === "ollama" || embeddingProvider === "ollama" || smallModels.some(({ provider }) => provider === "ollama")) {
      const installed = new Set(await getInstalledModels(config.ollamaBaseUrl));
      const missingPrimaryModel = llmProvider === "ollama" && !installed.has(llmModel);
      const missingSmallModel = smallModels.some(({ provider, model }) => provider === "ollama" && !installed.has(model));
      const missingEmbeddingModel = embeddingProvider === "ollama" && !installed.has(embeddingModel) || fieldMatcherSelection.provider === "ollama" && !installed.has(fieldMatcherSelection.model);
      if (missingPrimaryModel || missingSmallModel || missingEmbeddingModel) return reply.code(400).send({ message: "Select installed Ollama models." });
    }

    config.llmProvider = llmProvider; config.embeddingProvider = embeddingProvider;
    config.llmTemperature = llmTemperature;
    config.llmTemperatures = llmTemperatures;
    config.ragSoftInputTokens = ragSoftInputTokens;
    config.ragReservedOutputTokens = ragReservedOutputTokens;
    config.entityLinkerModel = entityLinkerModel;
    config.rerankerModel = rerankerModel;
    config.queryNormalizerModel = queryNormalizerModel;
    config.queryAnalyzerModel = queryAnalyzerModel;
    config.ocrCorrectorModel = ocrCorrectorModel;
    config.conversationSummaryModel = conversationSummaryModel;
    config.evidencePreparerModel = evidencePreparerModel;
    config.contradictionDetectorModel = contradictionDetectorModel;
    config.metadataLlmModel = metadataLlmModel;
    config.fieldMatcherModel = fieldMatcherModel;
    config.apiRerankerProvider = apiRerankerProvider;
    config.apiRerankerModel = apiRerankerProvider === "none" ? "" : apiRerankerModel;
    if (llmProvider === "ollama") config.ollamaLlmModel = llmModel; else if (llmProvider === "openai") config.openaiLlmModel = llmModel; else if (llmProvider === "gemini") config.geminiLlmModel = llmModel; else config.anthropicLlmModel = llmModel;
    if (embeddingProvider === "ollama") config.ollamaEmbeddingModel = embeddingModel; else if (embeddingProvider === "openai") config.openaiEmbeddingModel = embeddingModel; else config.geminiEmbeddingModel = embeddingModel;
    invalidateCapabilities();
    await persistSelectedModels(config);
    return { llmModel, metadataLlmModel, embeddingModel, queryNormalizerModel, queryAnalyzerModel, ocrCorrectorModel, conversationSummaryModel, evidencePreparerModel, contradictionDetectorModel, entityLinkerModel, rerankerModel, fieldMatcherModel, apiRerankerProvider, apiRerankerModel: config.apiRerankerModel, llmTemperature, llmTemperatures, ragSoftInputTokens, ragReservedOutputTokens, capabilities: await resolveModelCapabilities(config, true) };
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
      mode: request.body?.useLlm === undefined ? 'automatic' : 'user_configured',
      requestedStages: request.body?.useLlm === undefined ? undefined : { aliases: request.body.useLlm, relationships: request.body.useLlm, claims: request.body.useLlm, summary: request.body.useLlm },
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

    const operationId = randomUUID();
    modelPullOperations.set(operationId, { status: "running", model, completed: 0, total: 0, startedAt: Date.now() });
    void (async () => {
      try {
        const response = await fetch(`${config.ollamaBaseUrl}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: model, stream: true }) });
        if (!response.ok) throw new Error(`Ollama model download failed with ${response.status}.`);
        if (!response.body) throw new Error("Ollama did not return a download stream.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          for (const line of buffer.split("\n").slice(0, -1)) {
            try {
              const update = JSON.parse(line) as { total?: number; completed?: number; error?: string };
              if (update.error) throw new Error(update.error);
              const current = modelPullOperations.get(operationId);
              if (current) modelPullOperations.set(operationId, { ...current, completed: update.completed ?? current.completed, total: update.total ?? current.total });
            } catch (error) {
              if (error instanceof Error && error.message) throw error;
            }
          }
          buffer = buffer.includes("\n") ? buffer.slice(buffer.lastIndexOf("\n") + 1) : buffer;
          if (done) break;
        }
        modelPullOperations.set(operationId, { status: "completed", model, completed: 1, total: 1, startedAt: modelPullOperations.get(operationId)?.startedAt ?? Date.now() });
      } catch (error) {
        const current = modelPullOperations.get(operationId);
        modelPullOperations.set(operationId, { status: "failed", model, completed: current?.completed ?? 0, total: current?.total ?? 0, startedAt: current?.startedAt ?? Date.now(), error: error instanceof Error ? error.message : "Ollama model download failed." });
      }
    })();
    return reply.code(202).send({ operationId, model, status: "running" });
  });

  app.get("/api/settings/models/pull/active", async () => {
    return [...modelPullOperations.values()].filter((operation) => operation.status === "running");
  });

  app.get<{ Params: { operationId: string } }>("/api/settings/models/pull/:operationId", async (request, reply) => {
    const operation = modelPullOperations.get(request.params.operationId);
    if (!operation) return reply.code(404).send({ message: "Model download operation was not found." });
    return { ...operation, models: operation.status === "completed" ? await getInstalledModels(config.ollamaBaseUrl) : undefined };
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
