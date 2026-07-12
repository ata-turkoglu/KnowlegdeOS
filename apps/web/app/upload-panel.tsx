"use client";

import { useEffect, useMemo, useState } from "react";
import { AButton, ADialog, AFileInput, AInput, ATextarea } from "../components/ui";
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

export function UploadPanel() {
  const { workspaceSlug } = useWorkspace();
  const [prompt, setPrompt] = useState("");
  const [showExample, setShowExample] = useState(false);
  const [showOcrHelp, setShowOcrHelp] = useState(false);
  const [markdownFiles, setMarkdownFiles] = useState<File[]>([]);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [previewFileIndex, setPreviewFileIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);

  const promptPreview = useMemo(() => prompt || "Prompt yukleniyor...", [prompt]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/prompts/ocr-markdown`)
      .then((response) => response.json())
      .then((data: { prompt: string }) => setPrompt(data.prompt))
      .catch(() => setPrompt("OCR promptu API'den alinamadi."));
  }, []);

  async function handleMarkdownChange(files: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    setMarkdownFiles(selectedFiles);
    setPreviewFileIndex(0);
    setUploadedDocuments([]);
    setMessage("");

    if (selectedFiles.length === 0) {
      setPreview("");
      return;
    }

    setPreview(await selectedFiles[0].text());
    setTitle(
      selectedFiles.length === 1 ? selectedFiles[0].name.replace(/\.(md|txt)$/i, "") : ""
    );
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
    await navigator.clipboard.writeText(prompt);
    setMessage("Prompt kopyalandi.");
  }

  async function uploadDocuments() {
    if (markdownFiles.length === 0) {
      setMessage("Markdown dosyasi secilmedi.");
      return;
    }

    setIsUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("workspaceSlug", workspaceSlug);
    markdownFiles.forEach((file) => formData.append("markdown", file));

    if (markdownFiles.length === 1) {
      formData.append("title", title);

      if (originalFile) {
        formData.append("original", originalFile);
      }
    }

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
      setMessage(body.error ?? "Yukleme basarisiz.");
      return;
    }

    const documents: UploadedDocument[] = markdownFiles.length === 1 ? [body] : body.documents;
    setUploadedDocuments(documents);
    setMessage(`${documents.length} belge yuklendi. Indeksleme icin hazir.`);
  }

  async function indexUploadedDocuments(useLlm: boolean) {
    if (uploadedDocuments.length === 0) {
      setMessage("Once Markdown dosyasini yukle.");
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

      setMessage(`${uploadedDocuments.length} belge indekslendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Indeksleme basarisiz.");
    } finally {
      setIsIndexing(false);
    }
  }

  return (
    <section className="upload-grid">
      <div className="panel upload-panel upload-card">
        <div className="upload-heading">
          <div>
            <p className="eyebrow">Upload</p>
            <h3>Markdown calisma kopyasi</h3>
          </div>
          <AButton type="button" tone="secondary" onClick={() => setShowOcrHelp(true)}>
            OCR yardimini ac
          </AButton>
        </div>

        <div className="upload-fields">
          <label>
            Belge basligi
            <AInput value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label>
            Markdown dosyalari
            <AFileInput
              accept=".md,.txt,text/markdown,text/plain"
              multiple
              onChange={(event) => handleMarkdownChange(event.target.files)}
            />
          </label>

          <label>
            Orijinal tarama dosyasi (tek Markdown secildiginde)
            <AFileInput
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,application/pdf,image/*"
              onChange={(event) => setOriginalFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <AButton type="button" onClick={uploadDocuments} disabled={isUploading}>
          {isUploading ? "Yukleniyor..." : "Markdown dosyalarini yukle"}
        </AButton>

        {uploadedDocuments.length > 0 ? (
          <div className="upload-index-panel">
            <div>
              <strong>{uploadedDocuments.length} belge</strong>
              <span>{uploadedDocuments.map((document) => document.documentName).join(", ")}</span>
            </div>
            <div className="button-row">
              <AButton
                type="button"
                tone="secondary"
                onClick={() => indexUploadedDocuments(false)}
                disabled={isIndexing}
              >
                {isIndexing ? "Indeksleniyor..." : "Indeksle"}
              </AButton>
              <AButton
                type="button"
                onClick={() => indexUploadedDocuments(true)}
                disabled={isIndexing}
              >
                LLM ile indeksle
              </AButton>
            </div>
          </div>
        ) : null}

        {message ? <p className="form-message">{message}</p> : null}
      </div>

      <ADialog
        header="OCR yardimi"
        visible={showOcrHelp}
        onHide={() => setShowOcrHelp(false)}
        modal
        draggable={false}
        style={{ width: "min(720px, calc(100vw - 32px))" }}
      >
        <div>
          <h3>ChatGPT Markdown promptu</h3>
          <p>
            Taranmis PDF, JPG, PNG veya TIFF dosyasini once bu prompt ile
            KnowledgeOS uyumlu Markdown'a cevir.
          </p>
        </div>

        <ATextarea readOnly value={promptPreview} aria-label="OCR Markdown prompt" rows={12} />

        <div className="button-row">
          <AButton type="button" onClick={copyPrompt} disabled={!prompt}>
            Promptu kopyala
          </AButton>
          <AButton
            type="button"
            tone="secondary"
            onClick={() => setShowExample(!showExample)}
          >
            Ornek Markdown
          </AButton>
        </div>

        {showExample ? <pre className="code-preview">{exampleMarkdown}</pre> : null}
      </ADialog>

      <div className="panel preview-panel">
        <div>
          <p className="eyebrow">Onizleme</p>
          <h3>Yuklenen Markdown dosyalari</h3>
        </div>
        <div className="preview-content">
          <aside className="preview-file-list" aria-label="Yuklenen dosyalar">
            <strong>Dosyalar</strong>
            {markdownFiles.length > 0 ? (
              markdownFiles.map((file, index) => (
                <button
                  key={`${file.name}-${file.lastModified}`}
                  type="button"
                  className={index === previewFileIndex ? "is-active" : undefined}
                  onClick={() => void selectPreviewFile(index)}
                >
                  {file.name}
                </button>
              ))
            ) : (
              <p>Henuz dosya secilmedi.</p>
            )}
          </aside>

          <div className="preview-document">
            <h3>{markdownFiles[previewFileIndex]?.name ?? "Dosya onizlemesi"}</h3>
            <pre className="code-preview">
              {preview || "Markdown icerigi burada gorunecek."}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
