"use client";

import { useEffect, useState } from "react";
import { AButton, ADialog, ADropdown, AInput } from "../components/ui";
import { type PlatformLanguage, useLanguage } from "./language-context";

const languageOptions = [
  { label: "Turkce", value: "tr" },
  { label: "English", value: "en" }
];

const apiBaseUrl = "http://127.0.0.1:4000";
const providerOptions = [{ label: "Ollama", value: "ollama" }, { label: "OpenAI", value: "openai" }, { label: "Google Gemini", value: "gemini" }];

export function SettingsPanel() {
  const { language, setLanguage } = useLanguage();
  const [draftLanguage, setDraftLanguage] = useState<PlatformLanguage>(language);
  const [llmModel, setLlmModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [llmProvider, setLlmProvider] = useState("ollama");
  const [embeddingProvider, setEmbeddingProvider] = useState("ollama");
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
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraftLanguage(language);
  }, [language]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/settings/models`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Model list could not be loaded.");
        return response.json() as Promise<{ llmModel: string; embeddingModel: string; llmProvider?: string; embeddingProvider?: string; models: string[]; openai: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; gemini: { configured: boolean; llmModels: string[]; embeddingModels: string[] }; catalog: Array<{ name: string; kind: "llm" | "embedding"; description: string; capabilities: string[]; sizes: string[]; pulls?: string; tags?: string; updated?: string }> }>;
      })
      .then((settings) => {
        setLlmModel(settings.llmModel);
        setEmbeddingModel(settings.embeddingModel);
        setModels(settings.models);
        setCatalog(settings.catalog);
        setLlmProvider(settings.llmProvider ?? "ollama");
        setEmbeddingProvider(settings.embeddingProvider ?? "ollama");
        setCloudModels({ openai: settings.openai, gemini: settings.gemini });
      })
      .catch(() => setMessage(language === "tr" ? "Ollama modelleri yuklenemedi." : "Ollama models could not be loaded."))
      .finally(() => setLoading(false));
  }, [language]);

  async function saveSettings() {
    if (!llmModel || !embeddingModel) return;
    setMessage("");
    const response = await fetch(`${apiBaseUrl}/api/settings/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llmModel, embeddingModel, llmProvider, embeddingProvider })
    });
    if (!response.ok) {
      setMessage(language === "tr" ? "Model ayarlari kaydedilemedi." : "Model settings could not be saved.");
      return;
    }
    setLanguage(draftLanguage);
    setMessage(draftLanguage === "en" ? "Settings saved." : "Ayarlar kaydedildi.");
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
      setMessage(language === "tr" ? "Model indirildi. Asagidaki listelerden secebilirsiniz." : "Model downloaded. You can select it below.");
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
      setCloudModels((current) => ({ ...current, [provider]: { ...current[provider], configured: true } }));
      setApiKey("");
      setMessage(language === "tr" ? "API anahtari eklendi." : "API key added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API key could not be saved.");
    } finally { setSavingApiKey(false); }
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

  return (
    <section className="settings-panel panel">
      <div>
        <h3>{language === "tr" ? "Platform ayarlari" : "Platform settings"}</h3>
        <p>
          {language === "tr"
            ? "Platform tercihlerini buradan yonetin. Yeni ayarlar bu alana eklenecek."
            : "Manage platform preferences here. New settings will be added to this area."}
        </p>
      </div>

      <div className="settings-fields">
        <label>
          {language === "tr" ? "Platform dili" : "Platform language"}
          <ADropdown
            value={draftLanguage}
            options={languageOptions}
            onChange={(event) => {
              setDraftLanguage(event.value === "en" ? "en" : "tr");
              setMessage("");
            }}
          />
        </label>

        <label>
          {language === "tr" ? "LLM saglayicisi" : "LLM provider"}
          <ADropdown value={llmProvider} options={providerOptions} onChange={(event) => { setLlmProvider(String(event.value)); setApiKey(""); }} />
        </label>

        {llmProvider !== "ollama" && !cloudModels[llmProvider as "openai" | "gemini"].configured ? <div className="settings-api-key"><AInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`${llmProvider === "openai" ? "OpenAI" : "Gemini"} API key`} /><AButton onClick={() => void saveApiKey(llmProvider as "openai" | "gemini")} disabled={savingApiKey || !apiKey.trim()}>{language === "tr" ? "Anahtari ekle" : "Add key"}</AButton></div> : null}

        <label>
          {language === "tr" ? "LLM modeli" : "LLM model"}
          <div className="settings-model-control">
            <ADropdown value={llmModel} options={llmOptions} disabled={loading || (llmProvider !== "ollama" && !cloudModels[llmProvider as "openai" | "gemini"].configured)} onChange={(event) => setLlmModel(String(event.value))} />
            {llmProvider === "ollama" ? <AButton className="settings-model-add" tone="secondary" onClick={() => { setModelFilter(""); setDownloadDialog("llm"); }} disabled={loading} aria-label={language === "tr" ? "LLM indir" : "Download LLM"}>
              <i className="pi pi-plus" aria-hidden="true" />
            </AButton> : null}
          </div>
        </label>

        <label>
          {language === "tr" ? "Embedding saglayicisi" : "Embedding provider"}
          <ADropdown value={embeddingProvider} options={providerOptions} onChange={(event) => setEmbeddingProvider(String(event.value))} />
        </label>

        <label>
          {language === "tr" ? "Embedding modeli" : "Embedding model"}
          <div className="settings-model-control">
            <ADropdown value={embeddingModel} options={embeddingOptions} disabled={loading || (embeddingProvider !== "ollama" && !cloudModels[embeddingProvider as "openai" | "gemini"].configured)} onChange={(event) => setEmbeddingModel(String(event.value))} />
            {embeddingProvider === "ollama" ? <AButton className="settings-model-add" tone="secondary" onClick={() => { setModelFilter(""); setDownloadDialog("embedding"); }} disabled={loading} aria-label={language === "tr" ? "Embedding modeli indir" : "Download embedding model"}>
              <i className="pi pi-plus" aria-hidden="true" />
            </AButton> : null}
          </div>
        </label>
      </div>

      <div className="button-row">
        <AButton type="button" onClick={saveSettings} disabled={loading || !llmModel || !embeddingModel}>
          {language === "tr" ? "Kaydet" : "Save changes"}
        </AButton>
      </div>

      <p className="settings-note">
        {language === "tr"
          ? "Model secimleri API calisirken hemen uygulanir. Embedding modelini degistirdikten sonra anlamsal arama icin belgeleri yeniden indeksleyin."
          : "Model selections take effect immediately while the API is running. Reindex documents after changing the embedding model for semantic search."}
      </p>
      {message ? <p className="form-message">{message}</p> : null}
      <ADialog
        visible={downloadDialog !== null}
        onHide={() => !downloading && setDownloadDialog(null)}
        header={downloadDialog === "embedding" ? (language === "tr" ? "Embedding modeli indir" : "Download embedding model") : language === "tr" ? "LLM modeli indir" : "Download LLM model"}
        style={{ width: "min(520px, calc(100vw - 32px))" }}
        footer={<div className="button-row"><AButton tone="secondary" onClick={() => setDownloadDialog(null)} disabled={downloading}>{language === "tr" ? "Vazgec" : "Cancel"}</AButton><AButton disabled={downloading || !selectedDownloadModel} onClick={() => { void downloadModel(selectedDownloadModel).then((success) => success && setDownloadDialog(null)); }}>{downloading ? (language === "tr" ? "Indiriliyor..." : "Downloading...") : language === "tr" ? "Indir" : "Download"}</AButton></div>}
      >
        <p>{language === "tr" ? "Ollama kutuphanesinden bir model secin." : "Choose a model from the Ollama library."}</p>
        <AInput value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} placeholder={language === "tr" ? "Model ara" : "Search models"} disabled={downloading} />
        <div className="model-download-list" role="listbox" aria-label={language === "tr" ? "Model listesi" : "Model list"}>
          {dialogModels.map((model) => {
            const selected = selectedDownloadModel === model.name;
            const installed = models.some((installedModel) => installedModel.replace(/:.+$/, "") === model.name);
            return <button key={model.name} type="button" role="option" aria-selected={selected} className={`model-download-list__item${selected ? " is-selected" : ""}`} disabled={downloading} onClick={() => downloadDialog === "llm" ? setLlmToDownload(model.name) : setEmbeddingToDownload(model.name)}><span className="model-download-list__heading"><strong>{model.name}</strong>{installed ? <small>{language === "tr" ? "Yuklu" : "Installed"}</small> : null}</span><span className="model-download-list__description">{model.description}</span><span className="model-download-list__chips">{[...model.capabilities, ...model.sizes].map((tag) => <small key={tag}>{tag}</small>)}</span><span className="model-download-list__meta">{model.pulls ? <small><i className="pi pi-download" /> {model.pulls} Pulls</small> : null}{model.tags ? <small><i className="pi pi-tag" /> {model.tags} Tags</small> : null}{model.updated ? <small><i className="pi pi-clock" /> {model.updated}</small> : null}</span></button>;
          })}
          {dialogModels.length === 0 ? <p className="model-download-list__empty">{language === "tr" ? "Eslesen model bulunamadi." : "No matching models found."}</p> : null}
        </div>
      </ADialog>
    </section>
  );
}
