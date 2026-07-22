"use client";

import { useEffect, useState } from "react";
import { AButton, ADialog, ADropdown, AInfo, AInput, ATabMenu } from "../components/ui";
import { type PlatformLanguage, useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const languageOptions = [
  { label: "Türkçe", value: "tr" },
  { label: "English", value: "en" }
];

const apiBaseUrl = "http://127.0.0.1:4000";
const providerOptions = [{ label: "Ollama", value: "ollama" }, { label: "OpenAI", value: "openai" }, { label: "Google Gemini", value: "gemini" }];
const defaultIngestionValues = { chunkSize: "450", chunkOverlap: "60", similarityThreshold: "0.25" };
type LlmTemperatures = { extraction: number; answer: number; summary: number; creative: number };
const defaultLlmTemperatures: LlmTemperatures = { extraction: 0.1, answer: 0.3, summary: 0.3, creative: 0.7 };

export function SettingsPanel() {
  const { language, setLanguage } = useLanguage();
  const { workspaceSlug } = useWorkspace();
  const [draftLanguage, setDraftLanguage] = useState<PlatformLanguage>(language);
  const [llmModel, setLlmModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [llmProvider, setLlmProvider] = useState("ollama");
  const [embeddingProvider, setEmbeddingProvider] = useState("ollama");
  const [llmTemperatures, setLlmTemperatures] = useState<LlmTemperatures>(defaultLlmTemperatures);
  const [chunkSize, setChunkSize] = useState("450");
  const [chunkOverlap, setChunkOverlap] = useState("60");
  const [similarityThreshold, setSimilarityThreshold] = useState("0.25");
  const [staleDocumentCount, setStaleDocumentCount] = useState(0);
  const [reindexing, setReindexing] = useState(false);
  const [reindexOperationId, setReindexOperationId] = useState<string | null>(null);
  const [reindexProgress, setReindexProgress] = useState<{ completed: number; total: number; documentName?: string } | null>(null);
  const [useLlmForReindex, setUseLlmForReindex] = useState(false);
  const [cloudModels, setCloudModels] = useState<{ openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] } }>({ openai: { configured: false, llmModels: [], embeddingModels: [] }, gemini: { configured: false, llmModels: [], embeddingModels: [] } });
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
        return response.json() as Promise<{ llmModel: string; embeddingModel: string; llmProvider?: string; embeddingProvider?: string; llmTemperatures?: Partial<LlmTemperatures>; models: string[]; openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; catalog: Array<{ name: string; kind: "llm" | "embedding"; description: string; capabilities: string[]; sizes: string[]; pulls?: string; tags?: string; updated?: string }> }>;
      })
      .then((settings) => {
        setLlmModel(settings.llmModel);
        setEmbeddingModel(settings.embeddingModel);
        setModels(settings.models);
        setCatalog(settings.catalog);
        setLlmProvider(settings.llmProvider ?? "ollama");
        setEmbeddingProvider(settings.embeddingProvider ?? "ollama");
        setLlmTemperatures({
          extraction: settings.llmTemperatures?.extraction ?? defaultLlmTemperatures.extraction,
          answer: settings.llmTemperatures?.answer ?? defaultLlmTemperatures.answer,
          summary: settings.llmTemperatures?.summary ?? defaultLlmTemperatures.summary,
          creative: settings.llmTemperatures?.creative ?? defaultLlmTemperatures.creative
        });
        setCloudModels({ openai: settings.openai, gemini: settings.gemini });
      })
      .catch(() => setMessage(language === "tr" ? "Ollama modelleri yüklenemedi." : "Ollama models could not be loaded."))
      .finally(() => setLoading(false));
  }, [language]);

  useEffect(() => {
    setIngestionLoading(true);
    fetch(`${apiBaseUrl}/api/settings/ingestion/${encodeURIComponent(workspaceSlug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Ingestion settings could not be loaded.");
        return response.json() as Promise<{ settings: { chunkSize: number; chunkOverlap: number; similarityThreshold: number }; reindex: { staleDocumentCount: number } }>;
      })
      .then(({ settings, reindex }) => {
        setChunkSize(String(settings.chunkSize));
        setChunkOverlap(String(settings.chunkOverlap));
        setSimilarityThreshold(String(settings.similarityThreshold));
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
      if (!Number.isInteger(nextChunkSize) || nextChunkSize < 100 || nextChunkSize > 2_000 || !Number.isInteger(nextChunkOverlap) || nextChunkOverlap < 0 || nextChunkOverlap >= nextChunkSize || !Number.isFinite(nextThreshold) || nextThreshold < 0 || nextThreshold > 1) {
        setMessage(language === "tr" ? "İndeksleme alanlarını geçerli aralıklarda doldurun." : "Enter ingestion values within the allowed ranges.");
        return;
      }
      const ingestionResponse = await fetch(`${apiBaseUrl}/api/settings/ingestion/${encodeURIComponent(workspaceSlug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chunkSize: nextChunkSize, chunkOverlap: nextChunkOverlap, similarityThreshold: nextThreshold })
      });
      if (!ingestionResponse.ok) {
        setMessage(language === "tr" ? "İndeksleme ayarları kaydedilemedi." : "Ingestion settings could not be saved.");
        return;
      }
      const ingestionResult = await ingestionResponse.json() as { settings: { chunkSize: number; chunkOverlap: number; similarityThreshold: number }; reindex: { staleDocumentCount: number } };
      setChunkSize(String(ingestionResult.settings.chunkSize));
      setChunkOverlap(String(ingestionResult.settings.chunkOverlap));
      setSimilarityThreshold(String(ingestionResult.settings.similarityThreshold));
      setStaleDocumentCount(ingestionResult.reindex.staleDocumentCount);
      setMessage(language === "tr" ? "İndeksleme ayarları kaydedildi." : "Ingestion settings saved.");
      return;
    }

    if (!llmModel || !embeddingModel) return;
    const response = await fetch(`${apiBaseUrl}/api/settings/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmModel, embeddingModel, llmProvider, embeddingProvider, llmTemperatures: Object.fromEntries(Object.entries(llmTemperatures).map(([profile, temperature]) => [profile, Number(temperature)])) })
    });
    if (!response.ok) {
      setMessage(language === "tr" ? "Model ayarları kaydedilemedi." : "Model settings could not be saved.");
      return;
    }
    window.dispatchEvent(new Event("knowledgeos:model-settings-changed"));
    setMessage(language === "tr" ? "Model ayarları kaydedildi." : "Model settings saved.");
  }

  function resetIngestionSettings() {
    setChunkSize(defaultIngestionValues.chunkSize);
    setChunkOverlap(defaultIngestionValues.chunkOverlap);
    setSimilarityThreshold(defaultIngestionValues.similarityThreshold);
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
      const result = (await response.json()) as { models?: string[]; message?: string };
      if (!response.ok) throw new Error(result.message);
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

  async function saveApiKey(provider: "openai" | "gemini") {
    if (!apiKey.trim()) return;
    setSavingApiKey(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/providers/${provider}/key`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
      if (!response.ok) throw new Error("API key could not be saved.");
      const settingsResponse = await fetch(`${apiBaseUrl}/api/settings/models`);
      if (!settingsResponse.ok) throw new Error("Model list could not be refreshed.");
      const settings = await settingsResponse.json() as { models: string[]; openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] } };
      setModels(settings.models);
      setCloudModels({ openai: settings.openai, gemini: settings.gemini });
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
    const options = provider === "ollama" ? installedLlmOptions : cloudModels[provider as "openai" | "gemini"].llmModels;
    if (options[0]) setLlmModel(typeof options[0] === "string" ? options[0] : options[0].value);
  }

  function selectEmbeddingProvider(provider: string) {
    setEmbeddingProvider(provider);
    setApiKey("");
    const options = provider === "ollama" ? installedEmbeddingOptions : cloudModels[provider as "openai" | "gemini"].embeddingModels;
    if (options[0]) setEmbeddingModel(typeof options[0] === "string" ? options[0] : options[0].value);
  }

  const installedLlmOptions = models
    .filter((model) => !catalog.some((entry) => entry.name === model.replace(/:.+$/, "") && entry.kind === "embedding"))
    .map((model) => ({ label: `Ollama / ${model}`, value: model }));
  const installedEmbeddingOptions = models
    .filter((model) => catalog.some((entry) => entry.name === model.replace(/:.+$/, "") && entry.kind === "embedding"))
    .map((model) => ({ label: `Ollama / ${model}`, value: model }));
  const llmOptions = llmProvider === "ollama" ? installedLlmOptions : [...new Set(cloudModels[llmProvider as "openai" | "gemini"].llmModels)].map((model) => ({ label: model, value: model }));
  const embeddingOptions = embeddingProvider === "ollama" ? installedEmbeddingOptions : [...new Set(cloudModels[embeddingProvider as "openai" | "gemini"].embeddingModels)].map((model) => ({ label: model, value: model }));
  const dialogModels = catalog
    .filter((model) => model.kind === downloadDialog)
    .filter((model) => model.name.toLocaleLowerCase().includes(modelFilter.trim().toLocaleLowerCase()));
  const selectedDownloadModel = downloadDialog === "llm" ? llmToDownload : embeddingToDownload;
  const isInitialLoading = loading || ingestionLoading;
  const tabItems = [
    { label: language === "tr" ? "Genel" : "General", icon: "pi pi-cog" },
    { label: "LLM", icon: "pi pi-sparkles" },
    { label: "Embedding", icon: "pi pi-search" },
    { label: language === "tr" ? "İndeksleme ve arama" : "Ingestion & search", icon: "pi pi-sliders-h" }
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
          {language === "tr" ? "LLM sağlayıcısı" : "LLM provider"}
          <ADropdown value={llmProvider} options={providerOptions} onChange={(event) => selectLlmProvider(String(event.value))} />
        </label> : null}

        {activeTab === 1 ? <label>
          {language === "tr" ? "LLM modeli" : "LLM model"}
          <div className="settings-model-control">
            <ADropdown value={llmModel} options={llmOptions} disabled={loading || (llmProvider !== "ollama" && !cloudModels[llmProvider as "openai" | "gemini"].configured)} onChange={(event) => setLlmModel(String(event.value))} />
            {llmProvider === "ollama" ? <AButton className="settings-model-add" tone="secondary" onClick={() => { setModelFilter(""); setDownloadDialog("llm"); }} disabled={loading} aria-label={language === "tr" ? "LLM indir" : "Download LLM"}>
              <i className="pi pi-plus" aria-hidden="true" />
            </AButton> : null}
          </div>
        </label> : null}

        {activeTab === 1 ? <div className="settings-temperature-profiles">
          <label>
            <span className="label-with-info">
              {language === "tr" ? "Veri çıkarımı" : "Data extraction"}
              <AInfo description={language === "tr" ? "Belge, kişi, yer ve ilişki bilgilerini yapılandırılmış olarak çıkarır. Düşük sıcaklık daha tutarlı sonuç verir." : "Extracts documents, people, places, and relationships as structured data. A low temperature produces more consistent results."} position="right" />
            </span>
            <AInput type="number" min="0" max="2" step="0.1" value={String(llmTemperatures.extraction)} onChange={(event) => setLlmTemperatures((current) => ({ ...current, extraction: Number(event.target.value) }))} />
          </label>
          <label>
            <span className="label-with-info">
              {language === "tr" ? "Arşiv yanıtları" : "Archive answers"}
              <AInfo description={language === "tr" ? "Arşivdeki belgelere dayalı soru-cevap işlemlerinde kullanılır." : "Used when answering questions based on documents in the archive."} position="right" />
            </span>
            <AInput type="number" min="0" max="2" step="0.1" value={String(llmTemperatures.answer)} onChange={(event) => setLlmTemperatures((current) => ({ ...current, answer: Number(event.target.value) }))} />
          </label>
          <label>
            <span className="label-with-info">
              {language === "tr" ? "Özetleme" : "Summarization"}
              <AInfo description={language === "tr" ? "Belge ve arşiv içerikleri için kısa, anlaşılır özetler üretir." : "Produces concise, clear summaries of documents and archive content."} position="right" />
            </span>
            <AInput type="number" min="0" max="2" step="0.1" value={String(llmTemperatures.summary)} onChange={(event) => setLlmTemperatures((current) => ({ ...current, summary: Number(event.target.value) }))} />
          </label>
          <label>
            <span className="label-with-info">
              {language === "tr" ? "Yaratıcı üretim" : "Creative generation"}
              <AInfo description={language === "tr" ? "Taslak, fikir ve alternatif metinler üretmek için kullanılır. Daha yüksek sıcaklık daha çeşitli sonuç verir." : "Used for drafts, ideas, and alternative wording. A higher temperature produces more varied results."} position="right" />
            </span>
            <AInput type="number" min="0" max="2" step="0.1" value={String(llmTemperatures.creative)} onChange={(event) => setLlmTemperatures((current) => ({ ...current, creative: Number(event.target.value) }))} />
          </label>
        </div> : null}

        {activeTab === 1 && llmProvider !== "ollama" ? <div className="settings-api-key"><AInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={cloudModels[llmProvider as "openai" | "gemini"].configured ? "••••••••••••••••" : `${llmProvider === "openai" ? "OpenAI" : "Gemini"} API key`} /><AButton onClick={() => void saveApiKey(llmProvider as "openai" | "gemini")} disabled={savingApiKey || !apiKey.trim()}>{cloudModels[llmProvider as "openai" | "gemini"].configured ? (language === "tr" ? "Güncelle" : "Update") : language === "tr" ? "Ekle" : "Add"}</AButton></div> : null}

        {activeTab === 2 ? <label>
          {language === "tr" ? "Embedding sağlayıcısı" : "Embedding provider"}
          <ADropdown value={embeddingProvider} options={providerOptions} onChange={(event) => selectEmbeddingProvider(String(event.value))} />
        </label> : null}

        {activeTab === 2 && embeddingProvider !== "ollama" ? <div className="settings-api-key"><AInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={cloudModels[embeddingProvider as "openai" | "gemini"].configured ? "••••••••••••••••" : `${embeddingProvider === "openai" ? "OpenAI" : "Gemini"} API key`} /><AButton onClick={() => void saveApiKey(embeddingProvider as "openai" | "gemini")} disabled={savingApiKey || !apiKey.trim()}>{cloudModels[embeddingProvider as "openai" | "gemini"].configured ? (language === "tr" ? "Güncelle" : "Update") : language === "tr" ? "Ekle" : "Add"}</AButton></div> : null}

        {activeTab === 2 ? <label>
          {language === "tr" ? "Embedding modeli" : "Embedding model"}
          <div className="settings-model-control">
            <ADropdown value={embeddingModel} options={embeddingOptions} disabled={loading || (embeddingProvider !== "ollama" && !cloudModels[embeddingProvider as "openai" | "gemini"].configured)} onChange={(event) => setEmbeddingModel(String(event.value))} />
            {embeddingProvider === "ollama" ? <AButton className="settings-model-add" tone="secondary" onClick={() => { setModelFilter(""); setDownloadDialog("embedding"); }} disabled={loading} aria-label={language === "tr" ? "Embedding modeli indir" : "Download embedding model"}>
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
        <AButton type="button" onClick={saveSettings} disabled={loading || ((activeTab === 1 || activeTab === 2) && (!llmModel || !embeddingModel))}>
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
        onHide={() => !downloading && setDownloadDialog(null)}
        header={downloadDialog === "embedding" ? (language === "tr" ? "Embedding modeli indir" : "Download embedding model") : language === "tr" ? "LLM modeli indir" : "Download LLM model"}
        style={{ width: "min(520px, calc(100vw - 32px))" }}
        footer={<div className="button-row"><AButton tone="secondary" onClick={() => setDownloadDialog(null)} disabled={downloading}>{language === "tr" ? "Vazgeç" : "Cancel"}</AButton><AButton disabled={downloading || !selectedDownloadModel} onClick={() => { void downloadModel(selectedDownloadModel).then((success) => success && setDownloadDialog(null)); }}>{downloading ? (language === "tr" ? "İndiriliyor..." : "Downloading...") : language === "tr" ? "İndir" : "Download"}</AButton></div>}
      >
        <p>{language === "tr" ? "Ollama kütüphanesinden bir model seçin." : "Choose a model from the Ollama library."}</p>
        <AInput value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} placeholder={language === "tr" ? "Model ara" : "Search models"} disabled={downloading} />
        <div className="model-download-list" role="listbox" aria-label={language === "tr" ? "Model listesi" : "Model list"}>
          {dialogModels.map((model) => {
            const selected = selectedDownloadModel === model.name;
            const installed = models.some((installedModel) => installedModel.replace(/:.+$/, "") === model.name);
            return <button key={model.name} type="button" role="option" aria-selected={selected} className={`model-download-list__item${selected ? " is-selected" : ""}`} disabled={downloading} onClick={() => downloadDialog === "llm" ? setLlmToDownload(model.name) : setEmbeddingToDownload(model.name)}><span className="model-download-list__heading"><strong>{model.name}</strong>{installed ? <small>{language === "tr" ? "Yüklü" : "Installed"}</small> : null}</span><span className="model-download-list__description">{model.description}</span><span className="model-download-list__chips">{[...model.capabilities, ...model.sizes].map((tag) => <small key={tag}>{tag}</small>)}</span><span className="model-download-list__meta">{model.pulls ? <small><i className="pi pi-download" /> {model.pulls} Pulls</small> : null}{model.tags ? <small><i className="pi pi-tag" /> {model.tags} Tags</small> : null}{model.updated ? <small><i className="pi pi-clock" /> {model.updated}</small> : null}</span></button>;
          })}
          {dialogModels.length === 0 ? <p className="model-download-list__empty">{language === "tr" ? "Eşleşen model bulunamadı." : "No matching models found."}</p> : null}
        </div>
      </ADialog>
    </section>
  );
}
