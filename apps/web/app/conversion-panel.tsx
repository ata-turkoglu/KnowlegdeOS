"use client";

import { useEffect, useState } from "react";
import { AButton, ADialog, AFileInput, AIcon, AInput, ATextarea } from "../components/ui";
import { useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type ConvertedFile = {
  filename: string;
  title: string;
  sourceOriginal: string;
  size: number;
  convertedAt: string;
  hasYaml: boolean;
};

type YamlFilter = "all" | "with-yaml" | "without-yaml";
type YamlOperation = {
  id: string;
  kind: "yaml";
  targetName: string;
  documentNames?: string[];
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  stage: string;
  progress: number;
  error?: string;
};

export function ConversionPanel() {
  const { language } = useLanguage();
  const { workspaceSlug } = useWorkspace();
  const isEnglish = language === "en";
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [files, setFiles] = useState<ConvertedFile[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [yamlFilter, setYamlFilter] = useState<YamlFilter>("all");
  const [selectedConversion, setSelectedConversion] = useState<ConvertedFile | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [yamlOperation, setYamlOperation] = useState<YamlOperation | null>(null);
  const [yamlPromptVisible, setYamlPromptVisible] = useState(false);
  const [yamlPrompt, setYamlPrompt] = useState("");
  const [isLoadingYamlPrompt, setIsLoadingYamlPrompt] = useState(false);
  const [isSavingYamlPrompt, setIsSavingYamlPrompt] = useState(false);
  const [yamlPromptLlmModel, setYamlPromptLlmModel] = useState("");
  const visibleFiles = files.filter((file) => file.filename.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase())
    && (yamlFilter === "all" || (yamlFilter === "with-yaml" ? file.hasYaml : !file.hasYaml)));
  const yamlMissingFiles = files.filter((file) => !file.hasYaml);
  const isGeneratingYaml = yamlOperation?.status === "running";
  const yamlGeneratingFile = isGeneratingYaml
    ? yamlOperation.documentNames?.find((filename) => yamlOperation.stage.startsWith(filename)) ?? null
    : null;
  const yamlPartMatch = yamlOperation?.stage.match(/\((\d+)\/(\d+)\)/);
  const yamlPartCurrent = yamlPartMatch ? Number(yamlPartMatch[1]) : 0;
  const yamlPartTotal = yamlPartMatch ? Number(yamlPartMatch[2]) : 0;
  const yamlFileProgress = yamlPartTotal > 0 ? Math.round((yamlPartCurrent / yamlPartTotal) * 100) : yamlOperation?.progress ?? 0;
  const yamlFileIndex = yamlGeneratingFile ? (yamlOperation?.documentNames?.indexOf(yamlGeneratingFile) ?? -1) : -1;
  const yamlOverallProgress = yamlPartTotal > 0 && yamlFileIndex >= 0 && yamlOperation?.documentNames?.length
    ? ((yamlFileIndex + yamlPartCurrent / yamlPartTotal) / yamlOperation.documentNames.length) * 100
    : yamlOperation?.progress ?? 0;

  async function loadFiles() {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/conversions?workspaceSlug=${encodeURIComponent(workspaceSlug)}`);
      if (!response.ok) throw new Error("Conversion list could not be loaded.");
      setFiles(await response.json() as ConvertedFile[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conversion list could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadFiles(); }, [workspaceSlug]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function pollYamlOperation() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/operations?workspaceSlug=${encodeURIComponent(workspaceSlug)}`);
        if (!response.ok || cancelled) return;
        const operations = await response.json() as YamlOperation[];
        const operation = operations.find((item) => item.kind === "yaml" && item.status === "running")
          ?? operations.find((item) => item.kind === "yaml" && item.id === yamlOperation?.id);
        if (!operation || cancelled) return;
        setYamlOperation(operation);
        if (operation.status === "running") {
          timer = window.setTimeout(() => void pollYamlOperation(), 700);
          return;
        }
        await loadFiles();
        if (!cancelled) {
          setMessage(operation.status === "completed"
            ? (isEnglish ? "YAML metadata generation completed." : "YAML metadata oluşturma tamamlandı.")
            : operation.error ?? (isEnglish ? "YAML metadata generation stopped." : "YAML metadata oluşturma durduruldu."));
        }
      } catch { /* Keep the visible operation state until the next poll succeeds. */ }
    }
    void pollYamlOperation();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [workspaceSlug, yamlOperation?.id]);

  async function openYamlPrompt() {
    setYamlPromptVisible(true);
    setIsLoadingYamlPrompt(true);
    setYamlPromptLlmModel("");
    setMessage("");
    try {
      const [response, modelsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/settings/yaml-metadata-prompt/${encodeURIComponent(workspaceSlug)}`),
        fetch(`${apiBaseUrl}/api/settings/models`)
      ]);
      const body = await response.json() as { prompt?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "YAML metadata prompt could not be loaded.");
      setYamlPrompt(body.prompt ?? "");
      if (modelsResponse.ok) {
        const models = await modelsResponse.json() as { llmModel?: string };
        setYamlPromptLlmModel(models.llmModel ?? "");
      } else {
        setYamlPromptLlmModel("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "YAML metadata prompt could not be loaded.");
    } finally {
      setIsLoadingYamlPrompt(false);
    }
  }

  async function saveYamlPrompt() {
    if (!yamlPrompt.trim()) return;
    setIsSavingYamlPrompt(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/yaml-metadata-prompt/${encodeURIComponent(workspaceSlug)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: yamlPrompt }) });
      const body = await response.json() as { prompt?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "YAML metadata prompt could not be saved.");
      setYamlPrompt(body.prompt ?? yamlPrompt.trim());
      setYamlPromptVisible(false);
      setMessage(isEnglish ? "YAML metadata prompt saved." : "YAML metadata promptu kaydedildi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "YAML metadata prompt could not be saved.");
    } finally {
      setIsSavingYamlPrompt(false);
    }
  }

  async function selectFile(file: ConvertedFile) {
    setSelectedConversion(file);
    setMarkdown("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/conversions/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(file.filename)}`);
      const body = await response.json() as { markdown?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Markdown could not be loaded.");
      setMarkdown(body.markdown ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Markdown could not be loaded.");
    }
  }

  async function convert() {
    if (selectedFiles.length === 0) {
      setMessage(isEnglish ? "Choose at least one Word file first." : "Önce en az bir Word dosyası seçin.");
      return;
    }
    setIsConverting(true);
    setMessage("");
    try {
      const converted: ConvertedFile[] = [];
      for (const selectedFile of selectedFiles) {
        const formData = new FormData();
        formData.append("workspaceSlug", workspaceSlug);
        formData.append("word", selectedFile);
        const response = await fetch(`${apiBaseUrl}/api/conversions`, { method: "POST", body: formData });
        const body = await response.json() as ConvertedFile & { error?: string };
        if (!response.ok) throw new Error(`${selectedFile.name}: ${body.error ?? "Word conversion failed."}`);
        const splitResponse = await fetch(`${apiBaseUrl}/api/conversions/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(body.filename)}/split`, { method: "POST" });
        const splitBody = await splitResponse.json() as { files?: ConvertedFile[]; error?: string };
        if (!splitResponse.ok) throw new Error(`${selectedFile.name}: ${splitBody.error ?? "Markdown could not be split."}`);
        converted.push(...(splitBody.files ?? []));
      }
      setSelectedFiles([]);
      setFileInputKey((value) => value + 1);
      await loadFiles();
      if (converted.length === 1) await selectFile(converted[0]);
      setMessage(isEnglish ? `${converted.length} Markdown part(s) created.` : `${converted.length} Markdown parçası oluşturuldu.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Word conversion failed.");
    } finally {
      setIsConverting(false);
    }
  }

  async function remove(file: ConvertedFile) {
    if (!window.confirm(isEnglish ? `Delete ${file.filename}?` : `${file.filename} silinsin mi?`)) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/conversions/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(file.filename)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "Markdown could not be deleted.");
      }
      if (selectedConversion?.filename === file.filename) {
        setSelectedConversion(null);
        setMarkdown("");
      }
      await loadFiles();
      setMessage(isEnglish ? "Markdown deleted." : "Markdown silindi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Markdown could not be deleted.");
    }
  }

  async function generateYaml(file: ConvertedFile) {
    await generateYamlForFiles([file]);
  }

  async function generateYamlForFiles(targetFiles: ConvertedFile[]) {
    if (targetFiles.length === 0) return;
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/conversions/${encodeURIComponent(workspaceSlug)}/generate-yaml-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: targetFiles.map((file) => file.filename) })
      });
      const body = await response.json() as { operationId?: string; error?: string };
      if (!response.ok || !body.operationId) throw new Error(body.error ?? "YAML metadata generation could not be started.");
      setYamlOperation({ id: body.operationId, kind: "yaml", targetName: targetFiles.length === 1 ? targetFiles[0]!.filename : `${targetFiles.length} Markdown files`, documentNames: targetFiles.map((file) => file.filename), status: "running", stage: isEnglish ? "Queued for YAML metadata generation" : "YAML metadata üretimi kuyruğa alındı", progress: 0 });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "YAML metadata could not be generated.");
    }
  }

  async function cancelYamlGeneration() {
    if (!yamlOperation || yamlOperation.status !== "running") return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/operations/${encodeURIComponent(yamlOperation.id)}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "YAML metadata generation could not be cancelled.");
      setMessage(isEnglish ? "Stopping YAML metadata generation…" : "YAML metadata oluşturma durduruluyor…");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "YAML metadata generation could not be cancelled.");
    }
  }

  return <section className="conversion-layout">
    <div className="panel conversion-upload-card">
      <div>
        <p className="eyebrow">{isEnglish ? "File Conversion" : "Dosya Dönüştür"}</p>
        <h3>{isEnglish ? "Word to Markdown" : "Word'den Markdown'a"}</h3>
        <p>{isEnglish ? "Select a text-based .docx file. Scanned images and handwriting require OCR." : "Metin tabanlı bir .docx dosyası seçin. Taranmış görseller ve el yazıları OCR gerektirir."}</p>
      </div>
      <div className="conversion-upload-card__controls">
        <AFileInput key={fileInputKey} multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" chooseLabel={isEnglish ? "Choose Word files" : "Word dosyaları seç"} emptyLabel={isEnglish ? "No files selected" : "Dosya seçilmedi"} multipleSelectedLabel={(count) => isEnglish ? `${count} files selected` : `${count} dosya seçildi`} onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} />
        {selectedFiles.length > 0 ? <div className="conversion-selection"><strong>{isEnglish ? "Conversion queue" : "Dönüşüm kuyruğu"}</strong>{selectedFiles.map((file) => <span className="conversion-selection__item" key={`${file.name}-${file.lastModified}`}><i className="pi pi-file-word" aria-hidden="true" />{file.name}</span>)}</div> : null}
        <AButton onClick={() => void convert()} disabled={isConverting}>{isConverting ? (isEnglish ? `Converting ${selectedFiles.length} file(s)...` : `${selectedFiles.length} dosya dönüştürülüyor...`) : (isEnglish ? "Convert selected files" : "Seçilen dosyaları dönüştür")}</AButton>
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </div>

    <div className="panel conversion-files-card">
      <div className="conversion-files-header">
        <div>
          <p className="eyebrow">{isEnglish ? "Project files" : "Proje dosyaları"}</p>
          <h3>{isEnglish ? "Converted Markdown" : "Dönüştürülen Markdown"}</h3>
          <p>{isEnglish ? `${files.length} converted file${files.length === 1 ? "" : "s"} stored in the project's converted-markdown folder.` : `Proje içindeki converted-markdown klasöründe ${files.length} dönüştürülmüş dosya saklanır.`}</p>
        </div>
        <AButton type="button" tone="secondary" onClick={() => void openYamlPrompt()} disabled={isGeneratingYaml}>{isEnglish ? "YAML prompt" : "YAML promptu"}</AButton>
      </div>
      <div className="conversion-file-tools">
        <strong>{isEnglish ? `${files.length} files` : `${files.length} dosya`}</strong>
        <div className="conversion-yaml-filters" aria-label={isEnglish ? "YAML metadata filters" : "YAML metadata filtreleri"}>
          {(["all", "with-yaml", "without-yaml"] as YamlFilter[]).map((filter) => <AButton key={filter} type="button" tone="secondary" className={yamlFilter === filter ? "is-active" : undefined} onClick={() => setYamlFilter(filter)} disabled={isGeneratingYaml}>{filter === "all" ? (isEnglish ? "All" : "Tümü") : filter === "with-yaml" ? (isEnglish ? "YAML added" : "YAML eklendi") : (isEnglish ? "YAML missing" : "YAML yok")}</AButton>)}
        </div>
        {yamlMissingFiles.length ? <AButton type="button" tone="secondary" onClick={() => void generateYamlForFiles(yamlMissingFiles)} disabled={isGeneratingYaml}>{isEnglish ? `Add YAML to all (${yamlMissingFiles.length})` : `Tümüne YAML ekle (${yamlMissingFiles.length})`}</AButton> : null}
      </div>
      {isGeneratingYaml && yamlOperation ? <div className="form-message conversion-yaml-progress" role="status" aria-live="polite">
        <span><i className="pi pi-spinner pi-spin" aria-hidden="true" /> {yamlOperation.stage}</span>
        <progress value={yamlFileProgress} max="100" aria-label={isEnglish ? "Current file YAML metadata progress" : "Geçerli dosyanın YAML metadata ilerlemesi"} />
        <strong>{isEnglish ? `File ${yamlFileProgress}% · Total ${yamlOverallProgress.toFixed(1)}%` : `Dosya %${yamlFileProgress} · Toplam %${yamlOverallProgress.toFixed(1)}`}</strong>
        <AButton type="button" tone="secondary" onClick={() => void cancelYamlGeneration()}>{isEnglish ? "Stop" : "Durdur"}</AButton>
      </div> : null}
      {files.length > 0 ? <AInput className="conversion-file-search" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder={isEnglish ? "Search files" : "Dosya ara"} aria-label={isEnglish ? "Search project files" : "Proje dosyalarında ara"} /> : null}
      {message ? <p className="form-message" role="status">{message}</p> : null}
      <div className="conversion-file-list">
        {isLoading ? <p>{isEnglish ? "Loading..." : "Yükleniyor..."}</p> : null}
        {!isLoading && files.length === 0 ? <p>{isEnglish ? "No converted files yet." : "Henüz dönüştürülmüş dosya yok."}</p> : null}
        {!isLoading && files.length > 0 && visibleFiles.length === 0 ? <p>{isEnglish ? "No matching files found." : "Eşleşen dosya bulunamadı."}</p> : null}
        {visibleFiles.map((file) => <div key={file.filename} className={selectedConversion?.filename === file.filename ? "conversion-file is-active" : "conversion-file"}>
          <button type="button" onClick={() => void selectFile(file)}>
            <strong>{file.filename}</strong>
            <small>{yamlGeneratingFile === file.filename
              ? (isEnglish ? "LLM is generating YAML metadata…" : "LLM YAML metadata oluşturuyor…")
              : new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(file.convertedAt))}</small>
          </button>
          <div className="conversion-file-actions">
            <AIcon className={file.hasYaml ? "conversion-yaml-status is-ready" : "conversion-yaml-status is-missing"} icon={<i className={file.hasYaml ? "pi pi-check-circle" : "pi pi-clock"} />} tooltip={file.hasYaml ? (isEnglish ? "YAML metadata added" : "YAML metadata eklendi") : (isEnglish ? "YAML metadata missing" : "YAML metadata yok")} />
            <AButton tone="secondary" aria-label={isEnglish ? `${file.hasYaml ? "Update" : "Generate"} YAML metadata for ${file.filename}` : `${file.filename} için YAML metadata`} title={file.hasYaml ? (isEnglish ? "Update YAML metadata" : "YAML metadata güncelle") : (isEnglish ? "Generate YAML metadata" : "YAML metadata oluştur")} onClick={() => void generateYaml(file)} disabled={isGeneratingYaml}>
              <i className={yamlGeneratingFile === file.filename ? "pi pi-spinner pi-spin" : file.hasYaml ? "pi pi-refresh" : "pi pi-sparkles"} aria-hidden="true" />
            </AButton>
            <AButton tone="secondary" aria-label={isEnglish ? `Delete ${file.filename}` : `${file.filename} sil`} title={isEnglish ? "Delete" : "Sil"} onClick={() => void remove(file)} disabled={isGeneratingYaml}><i className="pi pi-trash" aria-hidden="true" /></AButton>
          </div>
        </div>)}
      </div>
      <div className="conversion-inline-preview">
        <div><p className="eyebrow">{isEnglish ? "Preview" : "Önizleme"}</p><h4>{selectedConversion?.filename ?? (isEnglish ? "Choose a file from the list" : "Listeden bir dosya seçin")}</h4></div>
        <ATextarea className="conversion-preview" readOnly value={markdown} placeholder={isEnglish ? "Converted Markdown appears here." : "Dönüştürülen Markdown burada görünür."} rows={15} />
      </div>
    </div>
    <ADialog
      visible={yamlPromptVisible}
      onHide={() => !isSavingYamlPrompt && setYamlPromptVisible(false)}
      header={isEnglish ? "YAML metadata prompt" : "YAML metadata promptu"}
      modal
      draggable={false}
      style={{ width: "min(860px, calc(100vw - 32px))" }}
      footer={<div className="button-row"><AButton type="button" tone="secondary" onClick={() => setYamlPromptVisible(false)} disabled={isSavingYamlPrompt}>{isEnglish ? "Cancel" : "Vazgeç"}</AButton><AButton type="button" onClick={() => void saveYamlPrompt()} disabled={isLoadingYamlPrompt || isSavingYamlPrompt || !yamlPrompt.trim()}>{isSavingYamlPrompt ? (isEnglish ? "Saving..." : "Kaydediliyor...") : (isEnglish ? "Save prompt" : "Promptu kaydet")}</AButton></div>}
    >
      <p>{isEnglish ? "This workspace's prompt is used whenever YAML metadata is generated. Keep the <system value> and <document content> placeholders so the application can provide them." : "Bu workspace'in promptu, YAML metadata oluşturulurken kullanılır. Uygulamanın değerleri ekleyebilmesi için <system value> ve <document content> yer tutucularını koruyun."}</p>
      {yamlPromptLlmModel ? <p className="conversion-yaml-prompt-model">{isEnglish ? "Active LLM model:" : "Seçili LLM modeli:"} <strong>{yamlPromptLlmModel}</strong></p> : null}
      <ATextarea className="conversion-yaml-prompt" value={yamlPrompt} onChange={(event) => setYamlPrompt(event.target.value)} disabled={isLoadingYamlPrompt || isSavingYamlPrompt} aria-label={isEnglish ? "YAML metadata prompt" : "YAML metadata promptu"} rows={24} />
    </ADialog>
  </section>;
}
