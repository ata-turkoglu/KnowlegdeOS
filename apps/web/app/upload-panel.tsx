"use client";

import { useState } from "react";
import { AButton, ADialog, AFileInput, AIcon, ATextarea } from "../components/ui";
import { useLanguage } from "./language-context";
import { ocrMarkdownPrompt } from "./ocr-markdown-prompt";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

const exampleMarkdown = `---
document_code: "A-8"
title: "Sulh ve Taksim Anlasmasi"
source_original: "A-8.pdf"
ocr_status: "chatgpt_ocr"
language: "tr"
document_type: "Anlasma"
date: ""
people:
  - "Ali Cobanoglu"
  - "Baki Toksal"
places:
  - "Beykoz"
parcels:
  - "247"
  - "248"
---

# A-8 Sulh ve Taksim Anlasmasi

[Sayfa 1]

Belge metni...`;

type UploadedDocument = {
  workspaceSlug: string;
  documentName: string;
  title: string;
  markdownPath: string;
  metadataPath: string;
};

type UploadConflictStatus = "NEW" | "DUPLICATE" | "CONFLICT";

export function UploadPanel() {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [showExample, setShowExample] = useState(false);
  const [showOcrHelp, setShowOcrHelp] = useState(false);
  const [markdownFiles, setMarkdownFiles] = useState<File[]>([]);
  const [fileStatuses, setFileStatuses] = useState<UploadConflictStatus[]>([]);
  const [preview, setPreview] = useState("");
  const [previewFileIndex, setPreviewFileIndex] = useState(0);
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);

  const hasConflicts = fileStatuses.includes("CONFLICT");

  async function handleMarkdownChange(files: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    setMarkdownFiles(selectedFiles);
    setFileStatuses([]);
    setPreviewFileIndex(0);
    setUploadedDocuments([]);
    setMessage("");

    if (selectedFiles.length === 0) {
      setPreview("");
      return;
    }

    setPreview(await selectedFiles[0].text());
    try {
      const files = await Promise.all(selectedFiles.map(async (file) => ({ filename: file.name, hash: await fileHash(file) })));
      const response = await fetch(`${apiBaseUrl}/api/documents/conflicts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceSlug, files })
      });
      if (!response.ok) throw new Error("Conflict check failed.");
      const conflicts = await response.json() as Array<{ status: UploadConflictStatus }>;
      setFileStatuses(conflicts.map((conflict) => conflict.status));
    } catch {
      setMessage(isEnglish ? "Existing-file check could not be completed." : "Mevcut dosya kontrolü tamamlanamadı.");
    }
  }

  async function selectPreviewFile(index: number) {
    const file = markdownFiles[index];

    if (!file) {
      return;
    }

    setPreviewFileIndex(index);
    setPreview(await file.text());
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(ocrMarkdownPrompt);
    setMessage(isEnglish ? "Prompt copied." : "Prompt kopyalandı.");
  }

  function conflictLabel(status: UploadConflictStatus) {
    if (status === "DUPLICATE") return isEnglish ? "Already exists" : "Zaten mevcut";
    if (status === "CONFLICT") return isEnglish ? "Same name, different content" : "Aynı ad, farklı içerik";
    return isEnglish ? "New" : "Yeni";
  }

  function conflictIcon(status: UploadConflictStatus) {
    if (status === "DUPLICATE") return <i className="pi pi-copy" />;
    if (status === "CONFLICT") return <i className="pi pi-exclamation-triangle" />;
    return <i className="pi pi-check-circle" />;
  }

  async function uploadDocuments() {
    if (markdownFiles.length === 0) {
      setMessage(isEnglish ? "No Markdown file selected." : "Markdown dosyası seçilmedi.");
      return;
    }

    setIsUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("workspaceSlug", workspaceSlug);
    markdownFiles.forEach((file) => formData.append("markdown", file));

    const response = await fetch(
      `${apiBaseUrl}/api/documents/${markdownFiles.length === 1 ? "upload" : "upload-batch"}`,
      {
      method: "POST",
      body: formData
      }
    );
    const body = await response.json();

    setIsUploading(false);

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Upload failed." : "Yükleme başarısız."));
      return;
    }

    const documents: UploadedDocument[] = markdownFiles.length === 1 ? [body] : body.documents;
    setUploadedDocuments(documents);
    setMessage(isEnglish ? `${documents.length} document(s) uploaded and ready to index.` : `${documents.length} belge yüklendi. İndeksleme için hazır.`);
  }

  async function indexUploadedDocuments(useLlm: boolean) {
    if (uploadedDocuments.length === 0) {
      setMessage(isEnglish ? "Upload a Markdown file first." : "Önce Markdown dosyasını yükle.");
      return;
    }

    setIsIndexing(true);
    setMessage("");

    try {
      for (const document of uploadedDocuments) {
        const response = await fetch(
          `${apiBaseUrl}/api/documents/${encodeURIComponent(
            document.workspaceSlug
          )}/${encodeURIComponent(document.documentName)}/reindex`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify({ useLlm })
          }
        );
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? `${document.documentName} indekslenemedi.`);
        }
      }

      setMessage(isEnglish ? `${uploadedDocuments.length} document(s) indexed.` : `${uploadedDocuments.length} belge indekslendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : isEnglish ? "Indexing failed." : "İndeksleme başarısız.");
    } finally {
      setIsIndexing(false);
    }
  }

  return (
    <section className="upload-grid">
      <div className="panel upload-panel upload-card">
        <div className="upload-heading">
          <div>
            <p className="eyebrow">{isEnglish ? "Upload" : "Yükle"}</p>
            <h3>{isEnglish ? "Markdown working copy" : "Markdown çalışma kopyası"}</h3>
          </div>
          <AButton type="button" tone="secondary" onClick={() => setShowOcrHelp(true)}>
            {isEnglish ? "Open OCR help" : "OCR yardımını aç"}
          </AButton>
        </div>

        <div className="upload-fields">
          <label>
            {isEnglish ? "Markdown files" : "Markdown dosyaları"}
            <AFileInput
              accept=".md,.txt,text/markdown,text/plain"
              multiple
              chooseLabel={isEnglish ? "Choose files" : "Dosya seç"}
              emptyLabel={isEnglish ? "No files selected" : "Dosya seçilmedi"}
              multipleSelectedLabel={(count) => isEnglish ? `${count} files selected` : `${count} dosya seçildi`}
              onChange={(event) => handleMarkdownChange(event.target.files)}
            />
          </label>

          <AButton className="upload-submit" type="button" onClick={uploadDocuments} disabled={isUploading || hasConflicts}>
            {isUploading ? (isEnglish ? "Uploading..." : "Yükleniyor...") : isEnglish ? "Upload Markdown files" : "Markdown dosyalarını yükle"}
          </AButton>
          {hasConflicts ? <p className="form-message">{isEnglish ? "Rename or remove files marked as conflicting before uploading." : "Yüklemeden önce çakışan olarak işaretlenen dosyaları yeniden adlandırın veya kaldırın."}</p> : null}
        </div>

        {uploadedDocuments.length > 0 ? (
          <div className="upload-index-panel">
            <div>
              <strong>{uploadedDocuments.length} {isEnglish ? "document(s)" : "belge"}</strong>
              <span>{uploadedDocuments.map((document) => document.documentName).join(", ")}</span>
            </div>
            <div className="button-row">
              <AButton
                type="button"
                tone="secondary"
                onClick={() => indexUploadedDocuments(false)}
                disabled={isIndexing}
              >
                {isIndexing ? (isEnglish ? "Indexing..." : "İndeksleniyor...") : isEnglish ? "Index" : "İndeksle"}
              </AButton>
              <AButton
                type="button"
                onClick={() => indexUploadedDocuments(true)}
                disabled={isIndexing}
              >
                {isEnglish ? "Index with LLM" : "LLM ile indeksle"}
              </AButton>
            </div>
          </div>
        ) : null}

        {message ? <p className="form-message">{message}</p> : null}
      </div>

      <ADialog
        header={isEnglish ? "OCR help" : "OCR yardımı"}
        visible={showOcrHelp}
        onHide={() => setShowOcrHelp(false)}
        modal
        draggable={false}
        style={{ width: "min(720px, calc(100vw - 32px))" }}
      >
        <div>
          <h3>{isEnglish ? "ChatGPT Markdown prompt" : "ChatGPT Markdown promptu"}</h3>
          <p>
            {isEnglish
              ? "Convert a scanned PDF, JPG, PNG, or TIFF file to KnowledgeOS-compatible Markdown with this prompt first."
              : "Taranmış PDF, JPG, PNG veya TIFF dosyasını önce bu prompt ile KnowledgeOS uyumlu Markdown'a çevir."}
          </p>
        </div>

        <ATextarea readOnly value={ocrMarkdownPrompt} aria-label={isEnglish ? "OCR Markdown prompt" : "OCR Markdown promptu"} rows={12} />

        <div className="button-row">
          <AButton type="button" onClick={copyPrompt}>
            {isEnglish ? "Copy prompt" : "Promptu kopyala"}
          </AButton>
          <AButton
            type="button"
            tone="secondary"
            onClick={() => setShowExample(!showExample)}
          >
            {isEnglish ? "Example Markdown" : "Örnek Markdown"}
          </AButton>
        </div>

        {showExample ? <pre className="code-preview">{exampleMarkdown}</pre> : null}
      </ADialog>

      <div className="panel preview-panel">
        <div>
          <p className="eyebrow">{isEnglish ? "Preview" : "Önizleme"}</p>
          <h3>{isEnglish ? "Uploaded Markdown files" : "Yüklenen Markdown dosyaları"}</h3>
        </div>
        <div className="preview-content">
          <aside className="preview-file-list" aria-label={isEnglish ? "Uploaded files" : "Yüklenen dosyalar"}>
            <strong>{isEnglish ? "Files" : "Dosyalar"}</strong>
            <div className="upload-conflict-legend" aria-label={isEnglish ? "File status legend" : "Dosya durumu açıklaması"}>
              {(["NEW", "DUPLICATE", "CONFLICT"] as const).map((status) => <span key={status} className={`upload-conflict upload-conflict--${status.toLowerCase()}`}><i aria-hidden="true" />{conflictLabel(status)}</span>)}
            </div>
            {markdownFiles.length > 0 ? (
              markdownFiles.map((file, index) => (
                <button
                  key={`${file.name}-${file.lastModified}`}
                  type="button"
                  className={[index === previewFileIndex ? "is-active" : "", fileStatuses[index] ? `preview-file-list__item--${fileStatuses[index].toLowerCase()}` : ""].filter(Boolean).join(" ") || undefined}
                  onClick={() => void selectPreviewFile(index)}
                >
                  <span>{file.name}</span>
                  {fileStatuses[index] ? <AIcon className={`upload-conflict upload-conflict--${fileStatuses[index].toLowerCase()}`} icon={conflictIcon(fileStatuses[index])} tooltip={conflictLabel(fileStatuses[index])} /> : null}
                </button>
              ))
            ) : (
              <p>{isEnglish ? "No file selected yet." : "Henüz dosya seçilmedi."}</p>
            )}
          </aside>

          <div className="preview-document">
            <h3>{markdownFiles[previewFileIndex]?.name ?? (isEnglish ? "File preview" : "Dosya önizlemesi")}</h3>
            <pre className="code-preview">
              {preview || (isEnglish ? "Markdown content will appear here." : "Markdown içeriği burada görünecek.")}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

async function fileHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
