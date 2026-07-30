"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AButton, ADialog, ADropdown, AInfo, AInput, ATabMenu } from "../components/ui";
import { type PlatformLanguage, useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const languageOptions = [
  { label: "Türkçe", value: "tr" },
  { label: "English", value: "en" }
];

const apiBaseUrl = "http://127.0.0.1:4000";
const providerOptions = [{ label: "Ollama", value: "ollama" }, { label: "OpenAI", value: "openai" }, { label: "Google Gemini", value: "gemini" }, { label: "Anthropic Claude", value: "anthropic" }];
const embeddingProviderOptions = providerOptions.filter((provider) => provider.value !== "anthropic");
const defaultIngestionValues = { chunkSize: "450", chunkOverlap: "60", similarityThreshold: "0.25", dateMinYear: "1800", dateMaxYear: String(new Date().getFullYear()) };
type LlmTemperatures = { extraction: number; answer: number; summary: number; creative: number };
type ModelCapabilities = { provider: string; model: string; inputTokenLimit: number | null; outputTokenLimit: number | null; runtimeContextLimit?: number | null; supportsTokenCounting: boolean; source: string; discoveredAt: string; warning?: string };
type SmallModelMetrics = Record<"queryNormalizer" | "queryAnalyzer" | "ocrCorrector" | "conversationSummary" | "evidencePreparer" | "contradictionDetector" | "entityLinker" | "reranker" | "fieldMatcher", { attempts: number; successes: number; fallbacks: number; accepted: number }>;
type HardwareProfile = { cpu: { model: string; logicalCores: number }; memoryTotalGb: number; gpu: { available: boolean; name?: string; memoryTotal?: number; reason?: string } };
type SmallModelRole = "metadata" | "queryNormalizer" | "queryAnalyzer" | "ocrCorrector" | "conversationSummary" | "evidencePreparer" | "contradictionDetector" | "entityLinker" | "reranker";
const primaryModelRecommendations = { openai: "gpt-5.4-mini", anthropic: "claude-sonnet-4-20250514" } as const;
const smallModelRecommendations: Record<SmallModelRole, { openai: string; anthropic: string }> = {
  metadata: { openai: "gpt-5-mini", anthropic: "claude-sonnet-4-20250514" },
  queryNormalizer: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  ocrCorrector: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  conversationSummary: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  evidencePreparer: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  contradictionDetector: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  queryAnalyzer: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  entityLinker: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" },
  reranker: { openai: "gpt-5.4-nano", anthropic: "claude-3-5-haiku-20241022" }
};
const defaultLlmTemperatures: LlmTemperatures = { extraction: 0.1, answer: 0.3, summary: 0.3, creative: 0.7 };
const emptySmallModelMetric = { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 };

function normalizeSmallModelMetrics(metrics?: Partial<SmallModelMetrics>): SmallModelMetrics {
  return {
    queryNormalizer: metrics?.queryNormalizer ?? emptySmallModelMetric,
    queryAnalyzer: metrics?.queryAnalyzer ?? emptySmallModelMetric,
    ocrCorrector: metrics?.ocrCorrector ?? emptySmallModelMetric,
    conversationSummary: metrics?.conversationSummary ?? emptySmallModelMetric,
    evidencePreparer: metrics?.evidencePreparer ?? emptySmallModelMetric,
    contradictionDetector: metrics?.contradictionDetector ?? emptySmallModelMetric,
    entityLinker: metrics?.entityLinker ?? emptySmallModelMetric,
    reranker: metrics?.reranker ?? emptySmallModelMetric,
    fieldMatcher: metrics?.fieldMatcher ?? emptySmallModelMetric
  };
}

function localModelSuitability(model: string, hardwareProfile: HardwareProfile | null, language: PlatformLanguage) {
  const normalized = model.toLocaleLowerCase();
  // nvidia-smi reports GPU memoryTotal in MiB, not GiB.
  const vram = hardwareProfile?.gpu.available ? hardwareProfile.gpu.memoryTotal ?? 0 : 0;
  const ram = hardwareProfile?.memoryTotalGb ?? 0;
  if (normalized.startsWith("qwen3:1.7b")) return vram >= 2048 || ram >= 12 ? (language === "tr" ? "Bu bilgisayar için hızlı" : "Fast on this computer") : (language === "tr" ? "CPU'da yavaş olabilir" : "May be slow on CPU");
  if (normalized.startsWith("qwen3:4b")) return vram >= 4096 && ram >= 12 ? (language === "tr" ? "Bu bilgisayar için önerilen" : "Recommended for this computer") : ram >= 16 ? (language === "tr" ? "CPU/RAM taşması ile çalışır" : "Runs with CPU/RAM offload") : (language === "tr" ? "Bu donanım için ağır" : "Heavy for this hardware");
  if (normalized.startsWith("qwen3:8b")) return vram >= 8192 ? (language === "tr" ? "GPU için uygun" : "Suitable for this GPU") : ram >= 16 ? (language === "tr" ? "CPU/RAM taşması ile yavaş" : "Slow with CPU/RAM offload") : (language === "tr" ? "Bu donanım için önerilmez" : "Not recommended for this hardware");
  return null;
}

export function SettingsPanel() {
  const { language, setLanguage } = useLanguage();
  const { workspaceSlug } = useWorkspace();
  const [draftLanguage, setDraftLanguage] = useState<PlatformLanguage>(language);
  const [llmModel, setLlmModel] = useState("");
  const [metadataLlmModel, setMetadataLlmModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [llmProvider, setLlmProvider] = useState("ollama");
  const [smallApiProvider, setSmallApiProvider] = useState<"openai" | "anthropic">("openai");
  const [embeddingProvider, setEmbeddingProvider] = useState("ollama");
  const [entityLinkerModel, setEntityLinkerModel] = useState("");
  const [rerankerModel, setRerankerModel] = useState("");
  const [queryNormalizerModel, setQueryNormalizerModel] = useState("");
  const [queryAnalyzerModel, setQueryAnalyzerModel] = useState("");
  const [ocrCorrectorModel, setOcrCorrectorModel] = useState("");
  const [conversationSummaryModel, setConversationSummaryModel] = useState("");
  const [evidencePreparerModel, setEvidencePreparerModel] = useState("");
  const [contradictionDetectorModel, setContradictionDetectorModel] = useState("");
  const [fieldMatcherModel, setFieldMatcherModel] = useState("");
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const [smallModelMetrics, setSmallModelMetrics] = useState<SmallModelMetrics | null>(null);
  const [llmTemperatures, setLlmTemperatures] = useState<LlmTemperatures>(defaultLlmTemperatures);
  const [ragSoftInputTokens, setRagSoftInputTokens] = useState("0");
  const [ragReservedOutputTokens, setRagReservedOutputTokens] = useState("1024");
  const [capabilities, setCapabilities] = useState<ModelCapabilities | null>(null);
  const [refreshingCapabilities, setRefreshingCapabilities] = useState(false);
  const [chunkSize, setChunkSize] = useState("450");
  const [chunkOverlap, setChunkOverlap] = useState("60");
  const [similarityThreshold, setSimilarityThreshold] = useState("0.25");
  const [dateMinYear, setDateMinYear] = useState(defaultIngestionValues.dateMinYear);
  const [dateMaxYear, setDateMaxYear] = useState(defaultIngestionValues.dateMaxYear);
  const [staleDocumentCount, setStaleDocumentCount] = useState(0);
  const [reindexing, setReindexing] = useState(false);
  const [reindexOperationId, setReindexOperationId] = useState<string | null>(null);
  const [reindexProgress, setReindexProgress] = useState<{ completed: number; total: number; documentName?: string } | null>(null);
  const [useLlmForReindex, setUseLlmForReindex] = useState(true);
  const [cloudModels, setCloudModels] = useState<{ openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; anthropic: { configured: boolean; llmModels: string[]; embeddingModels: string[] } }>({ openai: { configured: false, llmModels: [], embeddingModels: [] }, gemini: { configured: false, llmModels: [], embeddingModels: [] }, anthropic: { configured: false, llmModels: [], embeddingModels: [] } });
  const [models, setModels] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Array<{ name: string; kind: "llm" | "embedding"; description: string; capabilities: string[]; sizes: string[]; pulls?: string; tags?: string; updated?: string }>>([]);
  const [llmToDownload, setLlmToDownload] = useState("");
  const [embeddingToDownload, setEmbeddingToDownload] = useState("");
  const [downloadDialog, setDownloadDialog] = useState<"llm" | "embedding" | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ingestionLoading, setIngestionLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [modelDownloadOperationId, setModelDownloadOperationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    setDraftLanguage(language);
  }, [language]);

  useEffect(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/api/settings/models`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Model list could not be loaded.");
        return response.json() as Promise<{ llmModel: string; metadataLlmModel: string; embeddingModel: string; queryNormalizerModel: string; queryAnalyzerModel: string; ocrCorrectorModel: string; conversationSummaryModel: string; evidencePreparerModel: string; contradictionDetectorModel: string; entityLinkerModel: string; rerankerModel: string; fieldMatcherModel: string; hybridApiProvider?: string; hybridApiModel?: string; smallModelMetrics?: SmallModelMetrics; llmProvider?: string; embeddingProvider?: string; llmTemperatures?: Partial<LlmTemperatures>; ragSoftInputTokens?: number; ragReservedOutputTokens?: number; capabilities?: ModelCapabilities; hardwareProfile?: HardwareProfile; models: string[]; openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; anthropic: { configured: boolean; llmModels: string[] }; catalog: Array<{ name: string; kind: "llm" | "embedding"; description: string; capabilities: string[]; sizes: string[]; pulls?: string; tags?: string; updated?: string }> }>;
      })
      .then((settings) => {
        setLlmModel(settings.llmModel);
        setMetadataLlmModel(settings.metadataLlmModel);
        setEmbeddingModel(settings.embeddingModel);
        setEntityLinkerModel(settings.entityLinkerModel);
        setRerankerModel(settings.rerankerModel);
        setQueryNormalizerModel(settings.queryNormalizerModel);
        setQueryAnalyzerModel(settings.queryAnalyzerModel);
        setOcrCorrectorModel(settings.ocrCorrectorModel);
        setConversationSummaryModel(settings.conversationSummaryModel);
        setEvidencePreparerModel(settings.evidencePreparerModel);
        setContradictionDetectorModel(settings.contradictionDetectorModel);
        setFieldMatcherModel(settings.fieldMatcherModel);
        setSmallModelMetrics(normalizeSmallModelMetrics(settings.smallModelMetrics));
        setModels(settings.models);
        setCatalog(settings.catalog);
        setLlmProvider(settings.llmProvider ?? "ollama");
        setEmbeddingProvider(settings.embeddingProvider ?? "ollama");
        setRagSoftInputTokens(String(settings.ragSoftInputTokens ?? 0));
        setRagReservedOutputTokens(String(settings.ragReservedOutputTokens ?? 1024));
        setCapabilities(settings.capabilities ?? null);
        setHardwareProfile(settings.hardwareProfile ?? null);
        setLlmTemperatures({
          extraction: settings.llmTemperatures?.extraction ?? defaultLlmTemperatures.extraction,
          answer: settings.llmTemperatures?.answer ?? defaultLlmTemperatures.answer,
          summary: settings.llmTemperatures?.summary ?? defaultLlmTemperatures.summary,
          creative: settings.llmTemperatures?.creative ?? defaultLlmTemperatures.creative
        });
        setCloudModels({ openai: settings.openai, gemini: settings.gemini, anthropic: { ...settings.anthropic, embeddingModels: [] } });
        const savedSmallApiModel = [settings.metadataLlmModel, settings.queryNormalizerModel, settings.queryAnalyzerModel, settings.ocrCorrectorModel, settings.conversationSummaryModel, settings.evidencePreparerModel, settings.contradictionDetectorModel, settings.entityLinkerModel, settings.rerankerModel].find((model) => /^(openai|anthropic)\//.test(model));
        setSmallApiProvider(savedSmallApiModel?.startsWith("anthropic/") || (!savedSmallApiModel && settings.llmProvider === "anthropic") ? "anthropic" : "openai");
      })
      .catch(() => setMessage(language === "tr" ? "Ollama modelleri yüklenemedi." : "Ollama models could not be loaded."))
      .finally(() => setLoading(false));
  }, [language]);

  useEffect(() => {
    setIngestionLoading(true);
    fetch(`${apiBaseUrl}/api/settings/ingestion/${encodeURIComponent(workspaceSlug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Ingestion settings could not be loaded.");
        return response.json() as Promise<{ settings: { chunkSize: number; chunkOverlap: number; similarityThreshold: number; dateMinYear: number; dateMaxYear: number }; reindex: { staleDocumentCount: number } }>;
      })
      .then(({ settings, reindex }) => {
        setChunkSize(String(settings.chunkSize));
        setChunkOverlap(String(settings.chunkOverlap));
        setSimilarityThreshold(String(settings.similarityThreshold));
        setDateMinYear(String(settings.dateMinYear));
        setDateMaxYear(String(settings.dateMaxYear));
        setStaleDocumentCount(reindex.staleDocumentCount);
      })
      .catch(() => setMessage(language === "tr" ? "İndeksleme ayarları yüklenemedi." : "Ingestion settings could not be loaded."))
      .finally(() => setIngestionLoading(false));
  }, [language, workspaceSlug]);

  async function saveSettings() {
    setMessage("");
    if (activeTab === 0) {
      setLanguage(draftLanguage);
      setMessage(draftLanguage === "en" ? "Settings saved." : "Ayarlar kaydedildi.");
      return;
    }

    if (activeTab === 3) {
      const nextChunkSize = Number(chunkSize);
      const nextChunkOverlap = Number(chunkOverlap);
      const nextThreshold = Number(similarityThreshold);
      const nextDateMinYear = Number(dateMinYear);
      const nextDateMaxYear = Number(dateMaxYear);
      if (!Number.isInteger(nextChunkSize) || nextChunkSize < 100 || nextChunkSize > 2_000 || !Number.isInteger(nextChunkOverlap) || nextChunkOverlap < 0 || nextChunkOverlap >= nextChunkSize || !Number.isFinite(nextThreshold) || nextThreshold < 0 || nextThreshold > 1 || !Number.isInteger(nextDateMinYear) || !Number.isInteger(nextDateMaxYear) || nextDateMinYear < 1 || nextDateMaxYear < nextDateMinYear || nextDateMaxYear > new Date().getFullYear()) {
        setMessage(language === "tr" ? "İndeksleme alanlarını geçerli aralıklarda doldurun." : "Enter ingestion values within the allowed ranges.");
        return;
      }
      const ingestionResponse = await fetch(`${apiBaseUrl}/api/settings/ingestion/${encodeURIComponent(workspaceSlug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chunkSize: nextChunkSize, chunkOverlap: nextChunkOverlap, similarityThreshold: nextThreshold, dateMinYear: nextDateMinYear, dateMaxYear: nextDateMaxYear })
      });
      if (!ingestionResponse.ok) {
        setMessage(language === "tr" ? "İndeksleme ayarları kaydedilemedi." : "Ingestion settings could not be saved.");
        return;
      }
      const ingestionResult = await ingestionResponse.json() as { settings: { chunkSize: number; chunkOverlap: number; similarityThreshold: number; dateMinYear: number; dateMaxYear: number }; reindex: { staleDocumentCount: number } };
      setChunkSize(String(ingestionResult.settings.chunkSize));
      setChunkOverlap(String(ingestionResult.settings.chunkOverlap));
      setSimilarityThreshold(String(ingestionResult.settings.similarityThreshold));
      setDateMinYear(String(ingestionResult.settings.dateMinYear));
      setDateMaxYear(String(ingestionResult.settings.dateMaxYear));
      setStaleDocumentCount(ingestionResult.reindex.staleDocumentCount);
      setMessage(language === "tr" ? "İndeksleme ayarları kaydedildi." : "Ingestion settings saved.");
      return;
    }

    if (!llmModel || !metadataLlmModel || !embeddingModel || !queryNormalizerModel || !queryAnalyzerModel || !ocrCorrectorModel || !conversationSummaryModel || !evidencePreparerModel || !contradictionDetectorModel || !entityLinkerModel || !rerankerModel || !fieldMatcherModel) return;
    const softInputTokens = Number(ragSoftInputTokens);
    const reservedOutputTokens = Number(ragReservedOutputTokens);
    if (!Number.isInteger(softInputTokens) || softInputTokens < 0 || !Number.isInteger(reservedOutputTokens) || reservedOutputTokens < 256) {
      setMessage(language === "tr" ? "RAG token bütçeleri geçersiz." : "RAG token budgets are invalid.");
      return;
    }
    const response = await fetch(`${apiBaseUrl}/api/settings/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmModel, metadataLlmModel, embeddingModel, queryNormalizerModel, queryAnalyzerModel, ocrCorrectorModel, conversationSummaryModel, evidencePreparerModel, contradictionDetectorModel, entityLinkerModel, rerankerModel, fieldMatcherModel, llmProvider, embeddingProvider, ragSoftInputTokens: softInputTokens, ragReservedOutputTokens: reservedOutputTokens, llmTemperatures: Object.fromEntries(Object.entries(llmTemperatures).map(([profile, temperature]) => [profile, Number(temperature)])) })
    });
    if (!response.ok) {
      setMessage(language === "tr" ? "Model ayarları kaydedilemedi." : "Model settings could not be saved.");
      return;
    }
    const result = await response.json() as { capabilities?: ModelCapabilities };
    setCapabilities(result.capabilities ?? null);
    window.dispatchEvent(new Event("knowledgeos:model-settings-changed"));
    setMessage(language === "tr" ? "Model ayarları kaydedildi." : "Model settings saved.");
  }

  async function refreshModelCapabilities() {
    setRefreshingCapabilities(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/model-capabilities/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Capability discovery failed.");
      const result = await response.json() as { capabilities: ModelCapabilities };
      setCapabilities(result.capabilities);
      setMessage(language === "tr" ? "Model kapasitesi yenilendi." : "Model capabilities refreshed.");
    } catch {
      setMessage(language === "tr" ? "Model kapasitesi yenilenemedi." : "Model capabilities could not be refreshed.");
    } finally {
      setRefreshingCapabilities(false);
    }
  }

  function resetIngestionSettings() {
    setChunkSize(defaultIngestionValues.chunkSize);
    setChunkOverlap(defaultIngestionValues.chunkOverlap);
    setSimilarityThreshold(defaultIngestionValues.similarityThreshold);
    setDateMinYear(defaultIngestionValues.dateMinYear);
    setDateMaxYear(defaultIngestionValues.dateMaxYear);
    setMessage(language === "tr" ? "Varsayılan değerler forma uygulandı. Kaydet ile onaylayın." : "Default values were applied to the form. Save to confirm.");
  }

  function resetLlmTemperatureProfiles() {
    setLlmTemperatures(defaultLlmTemperatures);
    setMessage(language === "tr" ? "Sıcaklık profilleri varsayılan değerlere döndürüldü. Kaydet ile onaylayın." : "Temperature profiles were reset to their defaults. Save to confirm.");
  }

  async function reindexWorkspace() {
    setReindexing(true);
    setMessage(language === "tr" ? "Belgeler yeniden indeksleniyor..." : "Documents are being reindexed...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/ingestion/${encodeURIComponent(workspaceSlug)}/reindex`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ useLlm: useLlmForReindex })
      });
      const result = await response.json() as { operationId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Reindexing failed.");
      if (!result.operationId) throw new Error("Reindex operation could not be started.");
      setReindexOperationId(result.operationId);
      void pollReindexOperation(result.operationId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : language === "tr" ? "Yeniden indeksleme başarısız oldu." : "Reindexing failed.");
      setReindexing(false);
    }
  }

  async function pollReindexOperation(operationId: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/ingestion/reindex-operations/${encodeURIComponent(operationId)}`);
      const operation = await response.json() as { status?: "running" | "completed" | "cancelled" | "failed"; completed?: number; total?: number; documentName?: string; error?: string };
      if (!response.ok || !operation.status) throw new Error(operation.error ?? "Reindexing status could not be loaded.");
      setReindexProgress({ completed: operation.completed ?? 0, total: operation.total ?? 0, documentName: operation.documentName });
      if (operation.status === "running") {
        window.setTimeout(() => void pollReindexOperation(operationId), 700);
        return;
      }
      setReindexing(false);
      setReindexOperationId(null);
      if (operation.status === "completed") {
        setStaleDocumentCount(0);
        setMessage(language === "tr" ? "Tüm belgeler yeniden indekslendi." : "All documents were reindexed.");
      } else if (operation.status === "cancelled") {
        setMessage(language === "tr" ? "Yeniden indeksleme iptal edildi." : "Reindexing was cancelled.");
      } else {
        setMessage(operation.error ?? (language === "tr" ? "Yeniden indeksleme başarısız oldu." : "Reindexing failed."));
      }
    } catch (error) {
      setReindexing(false);
      setReindexOperationId(null);
      setMessage(error instanceof Error ? error.message : language === "tr" ? "Yeniden indeksleme durumu alınamadı." : "Reindexing status could not be loaded.");
    }
  }

  async function cancelReindexWorkspace() {
    if (!reindexOperationId) return;
    try {
      await fetch(`${apiBaseUrl}/api/settings/ingestion/reindex-operations/${encodeURIComponent(reindexOperationId)}`, { method: "DELETE" });
      setMessage(language === "tr" ? "İptal isteği gönderildi..." : "Cancellation requested...");
    } catch {
      setMessage(language === "tr" ? "İptal isteği gönderilemedi." : "Cancellation request could not be sent.");
    } finally {
      // The polling endpoint reports the final cancelled state.
    }
  }

  async function downloadModel(model: string) {
    if (!model) return false;
    setDownloading(true);
    setMessage(language === "tr" ? "Model indiriliyor..." : "Downloading model...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/models/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model })
      });
      const result = (await response.json()) as { operationId?: string; models?: string[]; message?: string };
      if (!response.ok) throw new Error(result.message);
      if (result.operationId) {
        setModelDownloadOperationId(result.operationId);
        setMessage(language === "tr" ? `${model} arka planda indiriliyor...` : `${model} is downloading in the background...`);
        void pollModelDownload(result.operationId, model);
        return true;
      }
      setModels(result.models ?? []);
      setLlmToDownload("");
      setEmbeddingToDownload("");
      setMessage(language === "tr" ? "Model indirildi. Aşağıdaki listelerden seçebilirsiniz." : "Model downloaded. You can select it below.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : language === "tr" ? "Model indirilemedi." : "Model could not be downloaded.");
      return false;
    } finally {
      setDownloading(false);
    }
  }

  async function pollModelDownload(operationId: string, model: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/models/pull/${encodeURIComponent(operationId)}`);
      const result = await response.json() as { status?: "running" | "completed" | "failed"; models?: string[]; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error ?? "Model download status could not be loaded.");
      if (result.status === "running") {
        window.setTimeout(() => void pollModelDownload(operationId, model), 1500);
        return;
      }
      setModelDownloadOperationId(null);
      setDownloading(false);
      if (result.status === "completed") {
        setModels(result.models ?? []);
        setMessage(language === "tr" ? `${model} indirildi. Model listesinden seçebilirsiniz.` : `${model} downloaded. You can select it from the model list.`);
      } else {
        setMessage(result.error ?? (language === "tr" ? `${model} indirilemedi.` : `${model} could not be downloaded.`));
      }
    } catch (error) {
      setModelDownloadOperationId(null);
      setDownloading(false);
      setMessage(error instanceof Error ? error.message : language === "tr" ? "Model indirme durumu alınamadı." : "Model download status could not be loaded.");
    }
  }

  function openDownloadDialog(kind: "llm" | "embedding") {
    setModelFilter("");
    if (kind === "llm") setLlmToDownload("");
    else setEmbeddingToDownload("");
    setDownloadDialog(kind);
  }

  async function saveApiKey(provider: "openai" | "gemini" | "anthropic") {
    if (!apiKey.trim()) return;
    setSavingApiKey(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/providers/${provider}/key`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
      if (!response.ok) throw new Error("API key could not be saved.");
      const settingsResponse = await fetch(`${apiBaseUrl}/api/settings/models`);
      if (!settingsResponse.ok) throw new Error("Model list could not be refreshed.");
      const settings = await settingsResponse.json() as { models: string[]; openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; anthropic: { configured: boolean; llmModels: string[]; embeddingModels: string[] } };
      setModels(settings.models);
      setCloudModels({ openai: settings.openai, gemini: settings.gemini, anthropic: { ...settings.anthropic, embeddingModels: [] } });
      setApiKey("");
      const providerModels = settings[provider];
      setMessage(language === "tr" ? `API anahtarı eklendi. ${providerModels.llmModels.length} LLM ve ${providerModels.embeddingModels.length} embedding modeli yüklendi.` : `API key added. ${providerModels.llmModels.length} LLM and ${providerModels.embeddingModels.length} embedding models loaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API key could not be saved.");
    } finally { setSavingApiKey(false); }
  }

  function selectLlmProvider(provider: string) {
    setLlmProvider(provider);
    setApiKey("");
    if (provider === "anthropic" && embeddingProvider !== "ollama") {
      selectEmbeddingProvider("ollama");
    }
    const options = provider === "ollama" ? installedLlmOptions : cloudModels[provider as "openai" | "gemini" | "anthropic"].llmModels;
    if (options[0]) {
      const model = typeof options[0] === "string" ? options[0] : options[0].value;
      setLlmModel(model);
    }
  }

  function selectSmallApiProvider(provider: string) {
    const next = provider === "anthropic" ? "anthropic" : "openai";
    setSmallApiProvider(next);
    if (next === "anthropic" && fieldMatcherModel.startsWith("openai/")) setFieldMatcherModel(installedEmbeddingOptions[0]?.value ?? "");
    const replaceApiModel = (value: string, role: SmallModelRole) => isApiSmallModel(value) ? `${next}/${smallModelRecommendations[role][next]}` : value;
    setMetadataLlmModel((value) => replaceApiModel(value, "metadata"));
    setQueryNormalizerModel((value) => replaceApiModel(value, "queryNormalizer"));
    setOcrCorrectorModel((value) => replaceApiModel(value, "ocrCorrector"));
    setConversationSummaryModel((value) => replaceApiModel(value, "conversationSummary"));
    setEvidencePreparerModel((value) => replaceApiModel(value, "evidencePreparer"));
    setContradictionDetectorModel((value) => replaceApiModel(value, "contradictionDetector"));
    setQueryAnalyzerModel((value) => replaceApiModel(value, "queryAnalyzer"));
    setEntityLinkerModel((value) => replaceApiModel(value, "entityLinker"));
    setRerankerModel((value) => replaceApiModel(value, "reranker"));
    if (llmProvider !== "ollama") {
      setLlmProvider(next);
      setLlmModel(primaryModelRecommendations[next]);
    }
  }

  function selectEmbeddingProvider(provider: string) {
    setEmbeddingProvider(provider);
    setApiKey("");
    const options = provider === "ollama" ? installedEmbeddingOptions : cloudModels[provider as "openai" | "gemini"].embeddingModels;
    if (options[0]) {
      const model = typeof options[0] === "string" ? options[0] : options[0].value;
      setEmbeddingModel(model);
      setFieldMatcherModel(model);
    }
  }

  const installedLlmOptions = models
    .filter((model) => !catalog.some((entry) => entry.name === model.replace(/:.+$/, "") && entry.kind === "embedding"))
    .map((model) => {
      const suitability = localModelSuitability(model, hardwareProfile, language);
      return { label: `Ollama / ${model}${suitability ? ` — ${suitability}` : ""}`, value: model };
    });
  const installedEmbeddingOptions = models
    .filter((model) => catalog.some((entry) => entry.name === model.replace(/:.+$/, "") && entry.kind === "embedding"))
    .map((model) => ({ label: `Ollama / ${model}`, value: model }));
  const embeddingOptions = embeddingProvider === "ollama" ? installedEmbeddingOptions : [...new Set(cloudModels[embeddingProvider as "openai" | "gemini"].embeddingModels)].map((model) => ({ label: model, value: model }));
  const fieldMatcherApiSelected = fieldMatcherModel.startsWith("openai/");
  const fieldMatcherApiOptions = [...new Set(["text-embedding-3-small", ...cloudModels.openai.embeddingModels])].map((model) => ({ label: `OpenAI / ${model}`, value: `openai/${model}` }));
  const isApiSmallModel = (model: string) => /^(openai|anthropic)\//.test(model);
  const smallApiOptions = (role: SmallModelRole) => {
    const recommendation = smallModelRecommendations[role];
    const recommendedModel = smallApiProvider === "anthropic" ? recommendation.anthropic : recommendation.openai;
    return [...new Set([recommendedModel, ...cloudModels[smallApiProvider].llmModels])].map((model) => ({
      label: `${smallApiProvider === "anthropic" ? "Claude" : "OpenAI"} / ${model}`,
      value: `${smallApiProvider}/${model}`,
      disabled: !cloudModels[smallApiProvider].configured
    }));
  };
  const smallModelDescription = (role: SmallModelRole) => {
    const recommendation = smallModelRecommendations[role];
    return language === "tr"
      ? `Yerel: Ollama modeliniz. API F/P önerisi: OpenAI ${recommendation.openai}; Claude ${recommendation.anthropic}. OpenAI nano yüksek hacimli yapılandırılmış işlerde, Claude Haiku kısa çıkarım ve sınıflandırmada uygundur.`
      : `Local: your Ollama model. API value recommendation: OpenAI ${recommendation.openai}; Claude ${recommendation.anthropic}. OpenAI nano suits high-volume structured work; Claude Haiku suits short extraction and classification.`;
  };
  const apiModelValueNote = (role: SmallModelRole) => {
    const recommendation = smallModelRecommendations[role];
    return language === "tr"
      ? `Fiyat/performans notu: ${smallApiProvider === "anthropic" ? `Claude ${recommendation.anthropic}` : `OpenAI ${recommendation.openai}`} bu görev için varsayılan öneridir. Listeden sağlayıcının diğer modellerini de seçebilirsiniz.`
      : `Value note: ${smallApiProvider === "anthropic" ? `Claude ${recommendation.anthropic}` : `OpenAI ${recommendation.openai}`} is the default recommendation for this task. You can also select other models offered by the provider.`;
  };
  function temperatureSetting(profile: "extraction" | "answer" | "summary", description: string, extra?: ReactNode) {
    return <details className="llm-layer-advanced">
      <summary>{language === "tr" ? "Gelişmiş ayarlar" : "Advanced settings"}</summary>
      <div className="llm-layer-advanced__content">
        <label>
          <span className="label-with-info">{language === "tr" ? "Sıcaklık" : "Temperature"}<AInfo description={description} position="right" /></span>
          <AInput type="number" min="0" max="2" step="0.1" value={String(llmTemperatures[profile])} onChange={(event) => setLlmTemperatures((current) => ({ ...current, [profile]: Number(event.target.value) }))} />
        </label>
        {extra}
      </div>
    </details>;
  }
  function renderSmallModelField(role: SmallModelRole, label: string, value: string, setValue: (next: string) => void, description: string, advanced?: ReactNode) {
    const apiSelected = isApiSmallModel(value);
    const localValue = apiSelected ? (installedLlmOptions[0]?.value ?? "") : value;
    const apiValue = apiSelected ? value : smallApiOptions(role).find((option) => !option.disabled)?.value ?? smallApiOptions(role)[0].value;
    return <div className="small-model-field">
      <span className="label-with-info">{label}<AInfo description={`${description} ${smallModelDescription(role)}`} position="right" /></span>
      <div className="small-model-choice-row">
        <span className="small-model-provider-choice">
          <label><input type="radio" name={`small-model-provider-${role}`} checked={!apiSelected} onChange={() => setValue(localValue)} disabled={loading || !localValue} /> Local</label>
          <label><input type="radio" name={`small-model-provider-${role}`} checked={apiSelected} onChange={() => setValue(apiValue)} disabled={loading || !cloudModels[smallApiProvider].configured} /> API</label>
        </span>
        {apiSelected
          ? <ADropdown value={value} options={smallApiOptions(role)} disabled={loading} onChange={(event) => setValue(String(event.value))} />
          : <ADropdown value={value} options={installedLlmOptions} disabled={loading} onChange={(event) => setValue(String(event.value))} />}
      </div>
      {apiSelected ? <p className="settings-note">{apiModelValueNote(role)}</p> : null}
      {advanced}
    </div>;
  }
  function renderPrimaryModelField(advanced?: ReactNode) {
    const apiSelected = llmProvider !== "ollama";
    const localValue = apiSelected ? (installedLlmOptions[0]?.value ?? "") : llmModel;
    const recommended = primaryModelRecommendations[smallApiProvider];
    const apiOptions = [...new Set([recommended, ...cloudModels[smallApiProvider].llmModels])].map((model) => ({ label: `${smallApiProvider === "anthropic" ? "Claude" : "OpenAI"} / ${model}`, value: model }));
    const apiValue = apiSelected ? llmModel : (apiOptions[0]?.value ?? "");
    return <div className="small-model-field">
      <span className="label-with-info">{language === "tr" ? "Ana kaynaklı cevap modeli" : "Main grounded-answer model"}<AInfo description={language === "tr" ? "Yalnızca arşiv kaynaklarına dayalı son sohbet cevabını üretir. YAML metadata katmanından tamamen ayrıdır." : "Produces only the final chat answer grounded in archive sources. It is fully separate from the YAML metadata layer."} position="right" /></span>
      <div className="small-model-choice-row">
        <span className="small-model-provider-choice">
          <label><input type="radio" name="primary-model-provider" checked={!apiSelected} onChange={() => { setLlmProvider("ollama"); setLlmModel(localValue); }} disabled={loading || !localValue} /> Local</label>
          <label><input type="radio" name="primary-model-provider" checked={apiSelected} onChange={() => { setLlmProvider(smallApiProvider); setLlmModel(apiValue); }} disabled={loading || !cloudModels[smallApiProvider].configured} /> API</label>
        </span>
        {apiSelected
          ? <ADropdown value={llmModel} options={apiOptions} disabled={loading || !cloudModels[smallApiProvider].configured} onChange={(event) => { setLlmProvider(smallApiProvider); setLlmModel(String(event.value)); }} />
          : <ADropdown value={llmModel} options={installedLlmOptions} disabled={loading} onChange={(event) => setLlmModel(String(event.value))} />}
      </div>
      {apiSelected ? <p className="settings-note">{apiModelValueNote("metadata")}</p> : null}
      {advanced}
    </div>;
  }
  const dialogModels = catalog
    .filter((model) => model.kind === downloadDialog)
    .filter((model) => model.name.toLocaleLowerCase().includes(modelFilter.trim().toLocaleLowerCase()));
  const selectedDownloadModel = downloadDialog === "llm" ? llmToDownload : embeddingToDownload;
  const isInitialLoading = loading || ingestionLoading;
  const tabItems = [
    { label: language === "tr" ? "Genel" : "General", icon: "pi pi-cog" },
    { label: language === "tr" ? "LLM katmanları" : "LLM layers", icon: "pi pi-sparkles" },
    { label: "Embedding", icon: "pi pi-search" },
    { label: language === "tr" ? "İndeksleme ve arama" : "Ingestion & search", icon: "pi pi-sliders-h" },
  ];

  return (
    <section className="settings-panel panel" aria-busy={isInitialLoading}>
      <div>
        <h3>{language === "tr" ? "Platform ayarları" : "Platform settings"}</h3>
        <p>
          {language === "tr"
            ? "Platform tercihlerini buradan yönetin. Yeni ayarlar bu alana eklenecek."
            : "Manage platform preferences here. New settings will be added to this area."}
        </p>
      </div>

      <ATabMenu model={tabItems} activeIndex={activeTab} onTabChange={(event) => setActiveTab(event.index)} />

      <div className={activeTab === 3 ? "settings-fields settings-fields--ingestion" : "settings-fields"}>
        {activeTab === 0 ? <label>
          {language === "tr" ? "Platform dili" : "Platform language"}
          <ADropdown
            value={draftLanguage}
            options={languageOptions}
            onChange={(event) => {
              setDraftLanguage(event.value === "en" ? "en" : "tr");
              setMessage("");
            }}
          />
        </label> : null}

        {activeTab === 3 ? <div className="settings-ingestion-grid">
          <div className="settings-ingestion-fields">
          <label>
            {language === "tr" ? "Chunk boyutu (kelime)" : "Chunk size (words)"}
            <AInput type="number" min="100" max="2000" value={chunkSize} onChange={(event) => setChunkSize(event.target.value)} />
          </label>
          <label>
            {language === "tr" ? "Chunk örtüşmesi (kelime)" : "Chunk overlap (words)"}
            <AInput type="number" min="0" value={chunkOverlap} onChange={(event) => setChunkOverlap(event.target.value)} />
          </label>
          <label>
            {language === "tr" ? "Benzerlik eşiği (0–1)" : "Similarity threshold (0–1)"}
            <AInput type="number" min="0" max="1" step="0.05" value={similarityThreshold} onChange={(event) => setSimilarityThreshold(event.target.value)} />
          </label>
          <label>
            {language === "tr" ? "Kabul edilen en eski yıl" : "Earliest accepted year"}
            <AInput type="number" min="1" max={new Date().getFullYear()} value={dateMinYear} onChange={(event) => setDateMinYear(event.target.value)} />
          </label>
          <label>
            {language === "tr" ? "Kabul edilen en yeni yıl" : "Latest accepted year"}
            <AInput type="number" min="1" max={new Date().getFullYear()} value={dateMaxYear} onChange={(event) => setDateMaxYear(event.target.value)} />
          </label>
          </div>
          <aside className="settings-ingestion-aside">
          <p className="settings-note">
            {language === "tr" ? "Bu ayarlar seçili workspace için geçerlidir. Chunk boyutu veya örtüşmesini değiştirdikten sonra belgeleri yeniden indeksleyin." : "These settings apply to the selected workspace. Reindex documents after changing chunk size or overlap."}
          </p>
          <section className="settings-reindex">
            <h4>{language === "tr" ? "İndeks durumu" : "Index status"}</h4>
            {staleDocumentCount > 0 ? <>
              <p>
                {language === "tr" ? `${staleDocumentCount} belge güncel ayarlarla yeniden indekslenmeli.` : `${staleDocumentCount} documents need reindexing with the current settings.`}
              </p>
            <label className="settings-checkbox">
              <input type="checkbox" checked={useLlmForReindex} disabled={reindexing} onChange={(event) => setUseLlmForReindex(event.target.checked)} />
              <span>{language === "tr" ? "LLM ile entity ve özet çıkarımını da yenile" : "Also refresh LLM entity extraction and summaries"}</span>
            </label>
            {useLlmForReindex ? <p className="settings-note">{language === "tr" ? "Bu seçenek her belge için LLM çağrısı yapar; işlem süresini ve bulut sağlayıcı maliyetini artırabilir." : "This makes an LLM request for every document and can increase processing time and cloud-provider cost."}</p> : null}
              <div className="button-row">
                <AButton type="button" tone="secondary" onClick={() => void reindexWorkspace()} disabled={reindexing}>
                  {reindexing ? (language === "tr" ? "Yeniden indeksleniyor..." : "Reindexing...") : language === "tr" ? "Tüm belgeleri yeniden indeksle" : "Reindex all documents"}
                </AButton>
                {reindexing ? <AButton type="button" tone="secondary" onClick={() => void cancelReindexWorkspace()}>
                  {language === "tr" ? "İptal" : "Cancel"}
                </AButton> : null}
              </div>
            {reindexProgress ? <p className="settings-note">
              {language === "tr" ? `${reindexProgress.completed}/${reindexProgress.total} belge işlendi${reindexProgress.documentName ? `: ${reindexProgress.documentName}` : ""}` : `${reindexProgress.completed}/${reindexProgress.total} documents processed${reindexProgress.documentName ? `: ${reindexProgress.documentName}` : ""}`}
            </p> : null}
            </> : <p>{language === "tr" ? "Tüm belgeler güncel indeksleme ayarlarıyla indekslendi." : "All documents use the current ingestion settings."}</p>}
          </section>
          </aside>
        </div> : null}

        {activeTab === 1 ? <label>
          <span className="label-with-info">
            {language === "tr" ? "API Sağlayıcısı" : "API Provider"}
            <AInfo description={language === "tr" ? "API radio ile seçilen tüm LLM katmanlarında bu sağlayıcı kullanılır." : "This provider is used by every LLM layer set to API."} position="right" />
          </span>
          <ADropdown value={smallApiProvider} options={[{ label: "OpenAI", value: "openai" }, { label: "Anthropic Claude", value: "anthropic" }]} disabled={loading} onChange={(event) => selectSmallApiProvider(String(event.value))} />
        </label> : null}

        {activeTab === 1 ? <div className="settings-api-key"><AInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={cloudModels[smallApiProvider].configured ? "••••••••••••••••" : `${smallApiProvider === "anthropic" ? "Anthropic" : "OpenAI"} API key`} /><AButton onClick={() => void saveApiKey(smallApiProvider)} disabled={savingApiKey || !apiKey.trim()}>{cloudModels[smallApiProvider].configured ? (language === "tr" ? "Güncelle" : "Update") : language === "tr" ? "Ekle" : "Add"}</AButton></div> : null}

        {activeTab === 2 ? <label>
          {language === "tr" ? "Embedding sağlayıcısı" : "Embedding provider"}
          <ADropdown value={embeddingProvider} options={embeddingProviderOptions} onChange={(event) => selectEmbeddingProvider(String(event.value))} />
        </label> : null}

        {activeTab === 1 ? <div className="llm-layer-list">
          <p className="settings-note">
            {hardwareProfile
              ? (language === "tr"
                ? `Algılanan donanım: ${hardwareProfile.cpu.model} · ${hardwareProfile.cpu.logicalCores} mantıksal çekirdek · ${hardwareProfile.memoryTotalGb} GB RAM${hardwareProfile.gpu.available ? ` · ${hardwareProfile.gpu.name} (${((hardwareProfile.gpu.memoryTotal ?? 0) / 1024).toFixed(1)} GB VRAM)` : " · NVIDIA GPU algılanamadı"}.`
                : `Detected hardware: ${hardwareProfile.cpu.model} · ${hardwareProfile.cpu.logicalCores} logical cores · ${hardwareProfile.memoryTotalGb} GB RAM${hardwareProfile.gpu.available ? ` · ${hardwareProfile.gpu.name} (${((hardwareProfile.gpu.memoryTotal ?? 0) / 1024).toFixed(1)} GB VRAM)` : " · NVIDIA GPU not detected"}.`)
              : (language === "tr" ? "Donanım profili algılanamadı; genel model etiketleri gösteriliyor." : "Hardware profile could not be detected; general model labels are shown.")}
            {" "}{language === "tr" ? "Yerel modeller aynı anda çalıştırılmaz: Ollama tek modeli yüklü ve tek isteği işleyen modda çalışır." : "Local models do not run simultaneously: Ollama keeps one model loaded and processes one request at a time."}
          </p>
          <section className="llm-layer-section">
            <h4>{language === "tr" ? "1. Dosya hazırlama ve indeksleme" : "1. File preparation and indexing"}</h4>
            {renderSmallModelField("metadata", language === "tr" ? "YAML metadata üretim modeli" : "YAML metadata generation model", metadataLlmModel, setMetadataLlmModel, language === "tr" ? "Yüklenen belgeden yapılandırılmış YAML üst bilgisini üretir; ana cevap modelinden bağımsızdır." : "Generates structured YAML front matter from an uploaded document; it is independent from the answer model.", temperatureSetting("extraction", language === "tr" ? "Deterministik ve şemaya uygun metadata için düşük tutulur." : "Keep low for deterministic, schema-conformant metadata."))}
            {renderSmallModelField("ocrCorrector", language === "tr" ? "OCR düzeltme modeli" : "OCR correction model", ocrCorrectorModel, setOcrCorrectorModel, language === "tr" ? "İndeksleme öncesinde yalnız belirgin OCR gürültüsünü düzeltir; içerik üretmez." : "Repairs only obvious OCR noise before indexing and does not generate content.", temperatureSetting("extraction", language === "tr" ? "Sayıları, tarihleri ve özel adları korumak için düşük tutulur." : "Keep low to preserve numbers, dates, and names."))}
            {renderSmallModelField("entityLinker", language === "tr" ? "Chunk entity linker modeli" : "Chunk entity linker model", entityLinkerModel, setEntityLinkerModel, language === "tr" ? "OCR, çekim ve yazım varyantlarını yalnız mevcut entity adaylarına bağlar." : "Links OCR, inflection, and spelling variants only to existing entity candidates.", temperatureSetting("extraction", language === "tr" ? "Yeni entity uydurmaması için düşük tutulur." : "Keep low to prevent invented entities."))}
            <div className="small-model-field">
              <span className="label-with-info">
                {language === "tr" ? "Metadata field matcher modeli" : "Metadata field matcher model"}
                <AInfo description={language === "tr" ? "Yeni metadata key için benzer workspace field adaylarını embedding ile bulur. Fiyat/performans önerisi OpenAI text-embedding-3-small'dır. Claude embedding sunmadığı için Claude seçiliyken API kapalıdır." : "Finds similar workspace fields for new metadata keys using embeddings. The value recommendation is OpenAI text-embedding-3-small. API is disabled under Claude because Anthropic does not offer embeddings."} position="right" />
              </span>
              <div className="small-model-choice-row">
                <span className="small-model-provider-choice">
                  <label><input type="radio" name="field-matcher-provider" checked={!fieldMatcherApiSelected} onChange={() => setFieldMatcherModel(installedEmbeddingOptions[0]?.value ?? "")} disabled={loading || !installedEmbeddingOptions.length} /> Local</label>
                  <label><input type="radio" name="field-matcher-provider" checked={fieldMatcherApiSelected} onChange={() => setFieldMatcherModel(fieldMatcherApiOptions[0]?.value ?? "")} disabled={loading || smallApiProvider === "anthropic" || !cloudModels.openai.configured} /> API</label>
                </span>
                <ADropdown value={fieldMatcherModel} options={fieldMatcherApiSelected ? fieldMatcherApiOptions : installedEmbeddingOptions} disabled={loading || (fieldMatcherApiSelected && !cloudModels.openai.configured)} onChange={(event) => setFieldMatcherModel(String(event.value))} />
              </div>
              {fieldMatcherApiSelected ? <p className="settings-note">{language === "tr" ? "Fiyat/performans notu: OpenAI text-embedding-3-small genel amaçlı embedding için varsayılan öneridir; sağlayıcının diğer embedding modellerini de seçebilirsiniz." : "Value note: OpenAI text-embedding-3-small is the default recommendation for general-purpose embeddings; you can also select the provider's other embedding models."}</p> : null}
              <details className="llm-layer-advanced"><summary>{language === "tr" ? "Gelişmiş ayarlar" : "Advanced settings"}</summary><p className="settings-note">{language === "tr" ? "Eşleştirme embedding benzerliği, tip uyumu, eşik ve margin doğrulamasıyla deterministik olarak kabul edilir." : "Matches are accepted deterministically using embedding similarity, type compatibility, threshold, and margin checks."}</p></details>
            </div>
          </section>

          <section className="llm-layer-section">
            <h4>{language === "tr" ? "2. Soru-cevap akışı" : "2. Question-answering flow"}</h4>
            {renderSmallModelField("conversationSummary", language === "tr" ? "Konuşma özeti modeli" : "Conversation summary model", conversationSummaryModel, setConversationSummaryModel, language === "tr" ? "Uzun konuşmalarda devam eden amacı, doğrulanmış bilgileri ve açık istekleri sıkıştırır." : "Compresses the ongoing goal, confirmed facts, and open requests in long conversations.", temperatureSetting("summary", language === "tr" ? "Kısa fakat anlamı koruyan özet dengesi için kullanılır." : "Controls the balance between concision and preserving meaning."))}
            {renderSmallModelField("queryNormalizer", language === "tr" ? "Sorgu normalizasyon modeli" : "Query normalization model", queryNormalizerModel, setQueryNormalizerModel, language === "tr" ? "Arama öncesinde yazım ve klavye hatalarını düzeltir; ham soruyu değiştirmez." : "Repairs spelling and keyboard errors before retrieval without changing the raw question.", temperatureSetting("extraction", language === "tr" ? "Kullanıcı niyetini değiştirmemek için düşük tutulur." : "Keep low to preserve user intent."))}
            {renderSmallModelField("queryAnalyzer", language === "tr" ? "Sorgu analiz modeli" : "Query analyzer model", queryAnalyzerModel, setQueryAnalyzerModel, language === "tr" ? "Niyet, tarih, entity ve metadata filtrelerini çıkarır." : "Extracts intent, dates, entities, and metadata filters.", temperatureSetting("extraction", language === "tr" ? "Kararlı filtre ve JSON üretimi için düşük tutulur." : "Keep low for stable filters and JSON."))}
            {renderSmallModelField("reranker", language === "tr" ? "Retrieval reranker modeli" : "Retrieval reranker model", rerankerModel, setRerankerModel, language === "tr" ? "RRF sonrasında aday chunk'ları sorguya göre yeniden sıralar; hata halinde lexical reranker kullanılır." : "Reorders candidate chunks after RRF and falls back to lexical reranking on failure.", temperatureSetting("extraction", language === "tr" ? "Sıralamanın tekrarlanabilir olması için düşük tutulur." : "Keep low for repeatable rankings."))}
            {renderSmallModelField("evidencePreparer", language === "tr" ? "Kanıt hazırlama modeli" : "Evidence preparation model", evidencePreparerModel, setEvidencePreparerModel, language === "tr" ? "Son cevap öncesinde kaynaklardan yalnız doğrulanabilir doğrudan alıntıları seçer." : "Selects only verifiable direct quotations before the final answer.", temperatureSetting("extraction", language === "tr" ? "Kaynak dışı ifade üretmemesi için düşük tutulur." : "Keep low to prevent unsupported wording."))}
            {renderSmallModelField("contradictionDetector", language === "tr" ? "Çelişki tespit modeli" : "Contradiction detection model", contradictionDetectorModel, setContradictionDetectorModel, language === "tr" ? "Kaynaklar arasındaki açık tarih, miktar, ad veya olgu çelişkilerini bulur." : "Finds explicit date, amount, name, or fact conflicts across sources.", temperatureSetting("extraction", language === "tr" ? "Yalnız açık çelişkileri işaretlemek için düşük tutulur." : "Keep low so only explicit conflicts are flagged."))}
            {renderPrimaryModelField(temperatureSetting("answer", language === "tr" ? "Kaynaklı cevaplarda doğruluk ve akıcılık dengesini belirler." : "Balances accuracy and fluency in grounded answers.", <>
              <p className="settings-note">{capabilities ? `${capabilities.model}: ${capabilities.inputTokenLimit?.toLocaleString() ?? "?"} input / ${capabilities.outputTokenLimit?.toLocaleString() ?? "?"} output tokens (${capabilities.source})` : language === "tr" ? "Model kapasitesi henüz okunmadı." : "Model capabilities have not been discovered yet."}</p>
              {capabilities?.warning ? <p className="settings-note">{capabilities.warning}</p> : null}
              <label>{language === "tr" ? "Yumuşak input limiti (0 = otomatik)" : "Soft input limit (0 = automatic)"}<AInput type="number" min="0" step="256" value={ragSoftInputTokens} onChange={(event) => setRagSoftInputTokens(event.target.value)} /></label>
              <label>{language === "tr" ? "Yanıt için ayrılan token" : "Reserved output tokens"}<AInput type="number" min="256" step="256" value={ragReservedOutputTokens} onChange={(event) => setRagReservedOutputTokens(event.target.value)} /></label>
              <AButton type="button" tone="secondary" onClick={() => void refreshModelCapabilities()} disabled={refreshingCapabilities || loading}>{refreshingCapabilities ? (language === "tr" ? "Yenileniyor..." : "Refreshing...") : language === "tr" ? "Kapasiteyi yenile" : "Refresh capabilities"}</AButton>
            </>))}
          </section>
          <p className="settings-note">
            {language === "tr" ? "Entity linker değişikliği için yeniden indeksleme gerekir. Reranker hemen uygulanır. Field matcher yalnız bundan sonraki metadata üretimlerinde kullanılır." : "Entity linker changes require reindexing. The reranker applies immediately. The field matcher is used for future metadata generation only."}
          </p>
          {smallModelMetrics ? <details className="llm-layer-advanced settings-note">
            <summary>{language === "tr" ? "Çalışma zamanı metrikleri" : "Runtime metrics"}</summary>
            <p>Query normalizer: {smallModelMetrics.queryNormalizer.successes}/{smallModelMetrics.queryNormalizer.attempts} · fallback {smallModelMetrics.queryNormalizer.fallbacks} · accepted {smallModelMetrics.queryNormalizer.accepted}</p>
            <p>Query analyzer: {smallModelMetrics.queryAnalyzer.successes}/{smallModelMetrics.queryAnalyzer.attempts} · fallback {smallModelMetrics.queryAnalyzer.fallbacks} · accepted {smallModelMetrics.queryAnalyzer.accepted}</p>
            <p>OCR corrector: {smallModelMetrics.ocrCorrector.successes}/{smallModelMetrics.ocrCorrector.attempts} · fallback {smallModelMetrics.ocrCorrector.fallbacks} · accepted {smallModelMetrics.ocrCorrector.accepted}</p>
            <p>Conversation summary: {smallModelMetrics.conversationSummary.successes}/{smallModelMetrics.conversationSummary.attempts} · fallback {smallModelMetrics.conversationSummary.fallbacks} · accepted {smallModelMetrics.conversationSummary.accepted}</p>
            <p>Evidence preparer: {smallModelMetrics.evidencePreparer.successes}/{smallModelMetrics.evidencePreparer.attempts} · fallback {smallModelMetrics.evidencePreparer.fallbacks} · accepted {smallModelMetrics.evidencePreparer.accepted}</p>
            <p>Contradiction detector: {smallModelMetrics.contradictionDetector.successes}/{smallModelMetrics.contradictionDetector.attempts} · fallback {smallModelMetrics.contradictionDetector.fallbacks} · accepted {smallModelMetrics.contradictionDetector.accepted}</p>
            <p>Entity linker: {smallModelMetrics.entityLinker.successes}/{smallModelMetrics.entityLinker.attempts} · fallback {smallModelMetrics.entityLinker.fallbacks} · accepted {smallModelMetrics.entityLinker.accepted}</p>
            <p>Reranker: {smallModelMetrics.reranker.successes}/{smallModelMetrics.reranker.attempts} · fallback {smallModelMetrics.reranker.fallbacks} · accepted {smallModelMetrics.reranker.accepted}</p>
            <p>Field matcher: {smallModelMetrics.fieldMatcher.successes}/{smallModelMetrics.fieldMatcher.attempts} · fallback {smallModelMetrics.fieldMatcher.fallbacks} · accepted {smallModelMetrics.fieldMatcher.accepted}</p>
          </details> : null}
        </div> : null}

        {activeTab === 2 && embeddingProvider !== "ollama" ? <div className="settings-api-key"><AInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={cloudModels[embeddingProvider as "openai" | "gemini"].configured ? "••••••••••••••••" : `${embeddingProvider === "openai" ? "OpenAI" : "Gemini"} API key`} /><AButton onClick={() => void saveApiKey(embeddingProvider as "openai" | "gemini")} disabled={savingApiKey || !apiKey.trim()}>{cloudModels[embeddingProvider as "openai" | "gemini"].configured ? (language === "tr" ? "Güncelle" : "Update") : language === "tr" ? "Ekle" : "Add"}</AButton></div> : null}

        {activeTab === 2 ? <label>
          {language === "tr" ? "Embedding modeli" : "Embedding model"}
          <div className="settings-model-control">
            <ADropdown value={embeddingModel} options={embeddingOptions} disabled={loading || (embeddingProvider !== "ollama" && !cloudModels[embeddingProvider as "openai" | "gemini"].configured)} onChange={(event) => setEmbeddingModel(String(event.value))} />
            {embeddingProvider === "ollama" ? <AButton className="settings-model-add" tone="secondary" onClick={() => openDownloadDialog("embedding")} disabled={loading} aria-label={language === "tr" ? "Embedding modeli indir" : "Download embedding model"}>
              <i className="pi pi-plus" aria-hidden="true" />
            </AButton> : null}
          </div>
        </label> : null}
      </div>

      <div className="button-row">
        {activeTab === 3 ? <AButton type="button" tone="secondary" onClick={resetIngestionSettings} disabled={loading || reindexing}>
          {language === "tr" ? "Varsayılanlara dön" : "Reset to defaults"}
        </AButton> : null}
        {activeTab === 1 ? <AButton type="button" tone="secondary" onClick={resetLlmTemperatureProfiles} disabled={loading}>
          {language === "tr" ? "Sıfırla" : "Reset"}
        </AButton> : null}
        <AButton type="button" onClick={saveSettings} disabled={loading || ((activeTab === 1 || activeTab === 2) && (!llmModel || !metadataLlmModel || !embeddingModel || !queryNormalizerModel || !queryAnalyzerModel || !ocrCorrectorModel || !conversationSummaryModel || !evidencePreparerModel || !contradictionDetectorModel || !entityLinkerModel || !rerankerModel || !fieldMatcherModel))}>
          {language === "tr" ? "Kaydet" : "Save changes"}
        </AButton>
      </div>

      <p className="settings-note">
        {language === "tr"
          ? "Model seçimleri API çalışırken hemen uygulanır. Embedding modelini değiştirdikten sonra anlamsal arama için belgeleri yeniden indeksleyin."
          : "Model selections take effect immediately while the API is running. Reindex documents after changing the embedding model for semantic search."}
      </p>
      {message ? <p className="form-message">{message}</p> : null}
      {isInitialLoading ? <div className="settings-panel__loading" role="status" aria-live="polite">
        <i className="pi pi-spin pi-spinner" aria-hidden="true" />
        <span>{language === "tr" ? "Ayarlar yükleniyor..." : "Loading settings..."}</span>
      </div> : null}
      <ADialog
        visible={downloadDialog !== null}
        onHide={() => setDownloadDialog(null)}
        header={downloadDialog === "embedding" ? (language === "tr" ? "Embedding modeli indir" : "Download embedding model") : language === "tr" ? "LLM modeli indir" : "Download LLM model"}
        style={{ width: "min(520px, calc(100vw - 32px))" }}
        footer={<div className="button-row"><AButton tone="secondary" onClick={() => setDownloadDialog(null)} disabled={downloading}>{language === "tr" ? "Vazgeç" : "Cancel"}</AButton><AButton disabled={downloading || !selectedDownloadModel} onClick={() => { void downloadModel(selectedDownloadModel).then((success) => success && setDownloadDialog(null)); }}>{downloading ? (language === "tr" ? "İndiriliyor..." : "Downloading...") : language === "tr" ? "İndir" : "Download"}</AButton></div>}
      >
        <p>{language === "tr" ? "Ollama kütüphanesinden bir model seçin." : "Choose a model from the Ollama library."}</p>
        <AInput value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} placeholder={language === "tr" ? "Model ara" : "Search models"} disabled={downloading} />
        <div className="model-download-list" role="listbox" aria-label={language === "tr" ? "Model listesi" : "Model list"}>
          {dialogModels.map((model) => {
            const selected = selectedDownloadModel === model.name;
            const installed = models.some((installedModel) => installedModel === model.name || installedModel.replace(/:.+$/, "") === model.name);
            return <button key={model.name} type="button" role="option" aria-selected={selected} className={`model-download-list__item${selected ? " is-selected" : ""}`} disabled={downloading} onClick={() => downloadDialog === "llm" ? setLlmToDownload(model.name) : setEmbeddingToDownload(model.name)}><span className="model-download-list__heading"><strong>{model.name}</strong>{installed ? <small>{language === "tr" ? "Yüklü" : "Installed"}</small> : null}</span><span className="model-download-list__description">{model.description}</span><span className="model-download-list__chips">{[...model.capabilities, ...model.sizes].map((tag) => <small key={tag}>{tag}</small>)}</span><span className="model-download-list__meta">{model.pulls ? <small><i className="pi pi-download" /> {model.pulls} Pulls</small> : null}{model.tags ? <small><i className="pi pi-tag" /> {model.tags} Tags</small> : null}{model.updated ? <small><i className="pi pi-clock" /> {model.updated}</small> : null}</span></button>;
          })}
          {dialogModels.length === 0 ? <p className="model-download-list__empty">{language === "tr" ? "Eşleşen model bulunamadı." : "No matching models found."}</p> : null}
        </div>
      </ADialog>
    </section>
  );
}
