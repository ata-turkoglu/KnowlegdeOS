"use client";

import { useEffect, useState } from "react";
import { AButton, ADropdown } from "../components/ui";
import { type PlatformLanguage, useLanguage } from "./language-context";

const languageOptions = [
  { label: "Turkce", value: "tr" },
  { label: "English", value: "en" }
];

const llmOptions = [
  { label: "Ollama / llama3.2", value: "ollama-llama3.2" },
  { label: "OpenAI / GPT-4.1", value: "openai-gpt-4.1" },
  { label: "OpenAI / GPT-4.1 mini", value: "openai-gpt-4.1-mini" }
];

const embeddingOptions = [
  { label: "Ollama / nomic-embed-text", value: "ollama-nomic-embed-text" },
  { label: "OpenAI / text-embedding-3-small", value: "openai-text-embedding-3-small" },
  { label: "OpenAI / text-embedding-3-large", value: "openai-text-embedding-3-large" }
];

export function SettingsPanel() {
  const { language, setLanguage } = useLanguage();
  const [draftLanguage, setDraftLanguage] = useState<PlatformLanguage>(language);
  const [llmModel, setLlmModel] = useState("ollama-llama3.2");
  const [embeddingTool, setEmbeddingTool] = useState("ollama-nomic-embed-text");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraftLanguage(language);
  }, [language]);

  function saveSettings() {
    setLanguage(draftLanguage);
    setMessage(draftLanguage === "en" ? "Settings saved." : "Ayarlar kaydedildi.");
  }

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
          {language === "tr" ? "LLM modeli" : "LLM model"}
          <ADropdown value={llmModel} options={llmOptions} onChange={(event) => setLlmModel(String(event.value))} />
        </label>

        <label>
          {language === "tr" ? "Embedding araci" : "Embedding tool"}
          <ADropdown value={embeddingTool} options={embeddingOptions} onChange={(event) => setEmbeddingTool(String(event.value))} />
        </label>
      </div>

      <div className="button-row">
        <AButton type="button" onClick={saveSettings}>
          {language === "tr" ? "Kaydet" : "Save changes"}
        </AButton>
      </div>

      <p className="settings-note">
        {language === "tr"
          ? "Dil tercihi bu tarayicida kaydedilir. Model ayarlari yakinda servis yapilandirmasina baglanacak."
          : "The language preference is saved in this browser. Model settings will be connected to service configuration soon."}
      </p>
      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
