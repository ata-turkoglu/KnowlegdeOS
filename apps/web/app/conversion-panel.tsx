"use client";

import { useEffect, useState } from "react";
import { AButton, AFileInput, AInput, ATextarea } from "../components/ui";
import { useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type ConvertedFile = {
  filename: string;
  title: string;
  sourceOriginal: string;
  size: number;
  convertedAt: string;
};

export function ConversionPanel() {
  const { language } = useLanguage();
  const { workspaceSlug } = useWorkspace();
  const isEnglish = language === "en";
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [files, setFiles] = useState<ConvertedFile[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [selectedConversion, setSelectedConversion] = useState<ConvertedFile | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const visibleFiles = files.filter((file) => file.filename.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()));

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
      <div>
        <p className="eyebrow">{isEnglish ? "Project files" : "Proje dosyaları"}</p>
        <h3>{isEnglish ? "Converted Markdown" : "Dönüştürülen Markdown"}</h3>
        <p>{isEnglish ? `${files.length} converted file${files.length === 1 ? "" : "s"} stored in the project's converted-markdown folder.` : `Proje içindeki converted-markdown klasöründe ${files.length} dönüştürülmüş dosya saklanır.`}</p>
      </div>
      {files.length > 0 ? <AInput className="conversion-file-search" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder={isEnglish ? "Search files" : "Dosya ara"} aria-label={isEnglish ? "Search project files" : "Proje dosyalarında ara"} /> : null}
      <div className="conversion-file-list">
        {isLoading ? <p>{isEnglish ? "Loading..." : "Yükleniyor..."}</p> : null}
        {!isLoading && files.length === 0 ? <p>{isEnglish ? "No converted files yet." : "Henüz dönüştürülmüş dosya yok."}</p> : null}
        {!isLoading && files.length > 0 && visibleFiles.length === 0 ? <p>{isEnglish ? "No matching files found." : "Eşleşen dosya bulunamadı."}</p> : null}
        {visibleFiles.map((file) => <div key={file.filename} className={selectedConversion?.filename === file.filename ? "conversion-file is-active" : "conversion-file"}>
          <button type="button" onClick={() => void selectFile(file)}>
            <strong>{file.filename}</strong>
            <small>{new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(file.convertedAt))}</small>
          </button>
          <AButton tone="secondary" aria-label={isEnglish ? `Delete ${file.filename}` : `${file.filename} sil`} onClick={() => void remove(file)}><i className="pi pi-trash" aria-hidden="true" /></AButton>
        </div>)}
      </div>
      <div className="conversion-inline-preview">
        <div><p className="eyebrow">{isEnglish ? "Preview" : "Önizleme"}</p><h4>{selectedConversion?.filename ?? (isEnglish ? "Choose a file from the list" : "Listeden bir dosya seçin")}</h4></div>
        <ATextarea className="conversion-preview" readOnly value={markdown} placeholder={isEnglish ? "Converted Markdown appears here." : "Dönüştürülen Markdown burada görünür."} rows={15} />
      </div>
    </div>
  </section>;
}
