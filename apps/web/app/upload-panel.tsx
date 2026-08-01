"use client";

import { useEffect, useRef, useState } from "react";
import { AButton, ADialog, AFileInput, AIcon, ATextarea } from "../components/ui";
import { useLanguage } from "./language-context";
import { ocrMarkdownPrompt } from "./ocr-markdown-prompt";
import { useWorkspace } from "./workspace-context";
import { OperationStatusButton } from "./operation-status-dialog";

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

type ConvertedFile = {
  filename: string;
  title: string;
  size: number;
  convertedAt: string;
};

type ConvertedFileStatus = {
  status: UploadConflictStatus;
  documentName: string;
  indexed: boolean;
};

type ConvertedFileFilter = "all" | "unindexed" | "indexed" | "conflict";

type PersistedUploadOperation = {
  workspaceSlug: string;
  status: "uploading" | "uploaded";
  fileNames: string[];
  documents?: UploadedDocument[];
};

type StoredOperation = {
  id: string;
  kind: "upload" | "index" | "reindex" | "embedding";
  targetName: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  progress: number;
  stage: string;
  documentNames?: string[];
};

type EmbeddingCoverageItem = {
  documentName: string;
  title: string;
  chunkCount: number;
  embeddedChunkCount: number;
  status: "MISSING" | "READY";
};

const uploadOperationStorageKey = "knowledgeos.uploadOperation";
const uploadOperationEvent = "knowledgeos:upload-operation";

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
  const [indexedDocumentNames, setIndexedDocumentNames] = useState<string[]>([]);
  const [embeddingCoverage, setEmbeddingCoverage] = useState<EmbeddingCoverageItem[]>([]);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embeddingOperation, setEmbeddingOperation] = useState<StoredOperation | null>(null);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingFileNames, setUploadingFileNames] = useState<string[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState({ completed: 0, total: 0 });
  const [batchOperationId, setBatchOperationId] = useState<string | null>(null);
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([]);
  const [convertedFileStatuses, setConvertedFileStatuses] = useState<Record<string, ConvertedFileStatus>>({});
  const [convertedFileFilter, setConvertedFileFilter] = useState<ConvertedFileFilter>("all");
  const [isCheckingConvertedStatuses, setIsCheckingConvertedStatuses] = useState(false);
  const [selectedConvertedFiles, setSelectedConvertedFiles] = useState<string[]>([]);
  const [isLoadingConverted, setIsLoadingConverted] = useState(false);
  const [isAddingConvertedFiles, setIsAddingConvertedFiles] = useState(false);
  const [addingConvertedFileCount, setAddingConvertedFileCount] = useState(0);
  const operationAbortController = useRef<AbortController | null>(null);

  const hasBlockedFiles = fileStatuses.some((status) => status === "DUPLICATE" || status === "CONFLICT");
  const convertedUploadFiles = convertedFiles.filter((file) => file.filename.includes("--"));
  const filteredConvertedUploadFiles = convertedUploadFiles.filter((file) => {
    const status = convertedFileStatuses[file.filename];
    if (convertedFileFilter === "all") return true;
    if (convertedFileFilter === "indexed") return status?.indexed === true;
    if (convertedFileFilter === "conflict") return status?.status === "CONFLICT";
    return status?.indexed !== true && status?.status !== "CONFLICT";
  });
  const selectedUploadableConvertedFiles = selectedConvertedFiles.filter((filename) => {
    const status = convertedFileStatuses[filename]?.status;
    return status !== "DUPLICATE" && status !== "CONFLICT";
  });
  const selectedExistingUnindexedFiles = selectedConvertedFiles.filter((filename) => {
    const file = convertedFileStatuses[filename];
    return file?.status === "DUPLICATE" && !file.indexed;
  });
  const embeddingDocumentNames = embeddingOperation?.documentNames ?? [];
  const currentEmbeddingDocument = embeddingOperation?.stage.startsWith("Embedding ") ? embeddingOperation.stage.slice("Embedding ".length) : undefined;
  const completedEmbeddingDocuments = embeddingOperation ? Math.floor((embeddingOperation.progress / 100) * embeddingDocumentNames.length) : 0;

  function embeddingRowState(documentName: string) {
    const coverage = embeddingCoverage.find((item) => item.documentName === documentName);
    if (coverage?.status === "READY") return { label: isEnglish ? "Embedding created" : "Embedding oluşturuldu", className: "is-complete" };
    if (embeddingOperation && embeddingDocumentNames.includes(documentName)) {
      if (documentName === currentEmbeddingDocument) return { label: isEnglish ? "Creating embedding" : "Embedding oluşturuluyor", className: "is-running" };
      if (embeddingDocumentNames.indexOf(documentName) < completedEmbeddingDocuments) return { label: isEnglish ? "Embedding created" : "Embedding oluşturuldu", className: "is-complete" };
      return { label: isEnglish ? "Embedding queued" : "Embedding sırada", className: "" };
    }
    return { label: isEnglish ? "Waiting for embedding" : "Embedding bekliyor", className: "" };
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoadingConverted(true);
    fetch(`${apiBaseUrl}/api/conversions?workspaceSlug=${encodeURIComponent(workspaceSlug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Converted files could not be loaded.");
        return response.json() as Promise<ConvertedFile[]>;
      })
      .then((files) => { if (!cancelled) setConvertedFiles(files); })
      .catch(() => { if (!cancelled) setConvertedFiles([]); })
      .finally(() => { if (!cancelled) setIsLoadingConverted(false); });
    return () => { cancelled = true; };
  }, [workspaceSlug]);

  async function loadEmbeddingCoverage() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(workspaceSlug)}/embedding-coverage`);
      if (!response.ok) throw new Error("Embedding coverage could not be loaded.");
      const coverage = await response.json() as EmbeddingCoverageItem[];
      setEmbeddingCoverage(coverage);
    } catch { /* Keep the last known list while a transient API refresh fails. */ }
  }

  useEffect(() => { void loadEmbeddingCoverage(); }, [workspaceSlug]);

  useEffect(() => {
    if (!isEmbedding) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/operations?workspaceSlug=${encodeURIComponent(workspaceSlug)}`);
        const operations = response.ok ? await response.json() as StoredOperation[] : [];
        const activeOperation = operations.find((operation) => operation.kind === "embedding" && operation.status === "running") ?? null;
        const running = activeOperation !== null;
        if (cancelled) return;
        setEmbeddingOperation(activeOperation);
        await loadEmbeddingCoverage();
        if (running) timer = window.setTimeout(() => void refresh(), 2500);
        else setIsEmbedding(false);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void refresh(), 2500);
      }
    };
    void refresh();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [isEmbedding, workspaceSlug]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/operations?workspaceSlug=${encodeURIComponent(workspaceSlug)}`)
      .then((response) => response.ok ? response.json() as Promise<StoredOperation[]> : [])
      .then((operations) => {
        if (cancelled) return;
        const activeEmbeddingOperation = operations.find((operation) => operation.kind === "embedding" && operation.status === "running") ?? null;
        setEmbeddingOperation(activeEmbeddingOperation);
        setIsEmbedding(activeEmbeddingOperation !== null);
        // Only restore an in-progress index operation. Restoring completed operations
        // makes a list the user cleared reappear whenever this page is refreshed.
        const activeIndex = operations.find((operation) => operation.kind === "index" && operation.status === "running" && (operation.documentNames?.length || operation.targetName.length > 0));
        if (!activeIndex) return;
        const documentNames = activeIndex.documentNames ?? activeIndex.targetName.split(", ").filter(Boolean);
        setUploadedDocuments(documentNames.map((documentName) => ({ workspaceSlug, documentName, title: documentName, markdownPath: "", metadataPath: "" })));
        setIndexingProgress({ completed: Math.round((activeIndex.progress / 100) * documentNames.length), total: documentNames.length });
        setIsIndexing(true);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceSlug]);

  useEffect(() => {
    if (uploadedDocuments.length === 0) {
      setIndexedDocumentNames([]);
      return;
    }
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/documents/statuses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceSlug, documentNames: uploadedDocuments.map((document) => document.documentName) })
    })
      .then((response) => response.ok ? response.json() as Promise<Array<{ documentName: string; status: string }>> : [])
      .then((statuses) => { if (!cancelled) setIndexedDocumentNames(statuses.filter((item) => item.status === "INDEXED").map((item) => item.documentName)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [uploadedDocuments, workspaceSlug, isIndexing]);

  useEffect(() => {
    function applyOperation(operation: PersistedUploadOperation | null) {
      if (!operation || operation.workspaceSlug !== workspaceSlug) return;
      setIsUploading(operation.status === "uploading");
      setUploadingFileNames(operation.status === "uploading" ? operation.fileNames : []);
      if (operation.status === "uploaded") {
        setUploadedDocuments(operation.documents ?? []);
        setMessage(isEnglish
          ? `${operation.documents?.length ?? 0} document(s) uploaded and ready to index.`
          : `${operation.documents?.length ?? 0} belge yüklendi. İndeksleme için hazır.`);
      }
    }

    setIsUploading(false);
    setUploadingFileNames([]);
    applyOperation(readUploadOperation());
    const onOperationChange = (event: Event) => applyOperation((event as CustomEvent<PersistedUploadOperation | null>).detail);
    window.addEventListener(uploadOperationEvent, onOperationChange);
    return () => window.removeEventListener(uploadOperationEvent, onOperationChange);
  }, [isEnglish, workspaceSlug]);

  useEffect(() => {
    const filesToCheck = convertedFiles.filter((file) => file.filename.includes("--"));
    let cancelled = false;

    if (filesToCheck.length === 0) {
      setConvertedFileStatuses({});
      setIsCheckingConvertedStatuses(false);
      return;
    }

    void (async () => {
      setIsCheckingConvertedStatuses(true);
      try {
        const response = await fetch(`${apiBaseUrl}/api/documents/conversion-conflicts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceSlug, filenames: filesToCheck.map((file) => file.filename) })
        });
        if (!response.ok) throw new Error("Conflict check failed.");
        const conflicts = await response.json() as Array<ConvertedFileStatus & { filename: string }>;
        if (!cancelled) setConvertedFileStatuses(Object.fromEntries(conflicts.map((conflict) => [conflict.filename, conflict])));
      } catch {
        if (!cancelled) setConvertedFileStatuses({});
      } finally {
        if (!cancelled) setIsCheckingConvertedStatuses(false);
      }
    })();

    return () => { cancelled = true; };
  }, [convertedFiles, workspaceSlug]);

  useEffect(() => {
    setSelectedConvertedFiles((current) => {
      const selectable = current.filter((filename) => !convertedFileStatuses[filename]?.indexed);
      return selectable.length === current.length ? current : selectable;
    });
  }, [convertedFileStatuses, selectedConvertedFiles]);

  useEffect(() => {
    let cancelled = false;

    fetch(`${apiBaseUrl}/api/documents/reindex-batches/active?workspaceSlug=${encodeURIComponent(workspaceSlug)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((operation) => {
        if (!cancelled && operation?.operationId) {
          setBatchOperationId(operation.operationId);
          setIsIndexing(operation.status === "running");
          setIndexingProgress({ completed: operation.completed ?? 0, total: operation.total ?? 0 });
        }
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [workspaceSlug]);

  useEffect(() => {
    if (!batchOperationId) return;
    const operationId = batchOperationId;
    let cancelled = false;

    async function pollOperation() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/documents/reindex-batches/${encodeURIComponent(operationId)}`);
        const operation = await response.json() as { status?: string; completed?: number; total?: number; error?: string };
        if (!response.ok || cancelled) return;
        setIndexingProgress({ completed: operation.completed ?? 0, total: operation.total ?? 0 });
        if (operation.status === "running") {
          window.setTimeout(() => void pollOperation(), 700);
          return;
        }
        setIsIndexing(false);
        setBatchOperationId(null);
        void loadEmbeddingCoverage();
        void fetch(`${apiBaseUrl}/api/operations?workspaceSlug=${encodeURIComponent(workspaceSlug)}`)
          .then((operationsResponse) => operationsResponse.ok ? operationsResponse.json() as Promise<StoredOperation[]> : [])
          .then((operations) => {
            const activeEmbeddingOperation = operations.find((item) => item.kind === "embedding" && item.status === "running") ?? null;
            setEmbeddingOperation(activeEmbeddingOperation);
            setIsEmbedding(activeEmbeddingOperation !== null);
          })
          .catch(() => undefined);
        setMessage(operation.status === "completed"
          ? (isEnglish ? "Documents indexed." : "Belgeler indekslendi.")
          : operation.status === "cancelled"
            ? (isEnglish ? "Indexing cancelled. Completed documents were kept." : "İndeksleme iptal edildi. Tamamlanan belgeler korundu.")
            : (operation.error ?? (isEnglish ? "Indexing failed." : "İndeksleme başarısız.")));
      } catch {
        if (!cancelled) setIsIndexing(false);
      }
    }

    void pollOperation();
    return () => { cancelled = true; };
  }, [batchOperationId, isEnglish]);

  async function setSelectedMarkdownFiles(selectedFiles: File[]) {
    clearUploadOperation();
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

  async function clearUploadList() {
    await setSelectedMarkdownFiles([]);
  }

  async function handleMarkdownChange(files: FileList | null) {
    await setSelectedMarkdownFiles(files ? Array.from(files) : []);
  }

  async function addConvertedFiles() {
    if (selectedConvertedFiles.length === 0) {
      setMessage(isEnglish ? "Select converted Markdown files first." : "Önce dönüştürülmüş Markdown dosyalarını seçin.");
      return;
    }
    if (selectedUploadableConvertedFiles.length === 0) {
      setMessage(isEnglish ? "The selected files already exist. Select unindexed existing files and use the indexing action instead." : "Seçili dosyalar zaten mevcut. İndekslenmemiş mevcut dosyaları seçip indeksleme işlemini kullanın.");
      return;
    }
    setIsAddingConvertedFiles(true);
    setAddingConvertedFileCount(0);
    try {
      const downloaded: File[] = [];
      for (const filename of selectedUploadableConvertedFiles) {
        const response = await fetch(`${apiBaseUrl}/api/conversions/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(filename)}`);
        const body = await response.json() as { markdown?: string; error?: string };
        if (!response.ok) throw new Error(body.error ?? `${filename} could not be loaded.`);
        downloaded.push(new File([body.markdown ?? ""], filename, { type: "text/markdown" }));
        setAddingConvertedFileCount(downloaded.length);
      }
      const combined = [...markdownFiles.filter((file) => !selectedUploadableConvertedFiles.includes(file.name)), ...downloaded];
      await setSelectedMarkdownFiles(combined);
      setMessage(isEnglish ? `${downloaded.length} converted file(s) added to the upload list.` : `${downloaded.length} dönüştürülmüş dosya yükleme listesine eklendi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEnglish ? "Converted files could not be added." : "Dönüştürülmüş dosyalar eklenemedi."));
    } finally {
      setIsAddingConvertedFiles(false);
      setAddingConvertedFileCount(0);
    }
  }

  function selectAllConvertedFiles() {
    setSelectedConvertedFiles(filteredConvertedUploadFiles
      .filter((file) => !convertedFileStatuses[file.filename]?.indexed && convertedFileStatuses[file.filename]?.status !== "CONFLICT")
      .map((file) => file.filename));
  }

  function selectExistingUnindexedFiles() {
    setSelectedConvertedFiles(filteredConvertedUploadFiles.filter((file) => {
      const status = convertedFileStatuses[file.filename];
      return status?.status === "DUPLICATE" && !status.indexed;
    }).map((file) => file.filename));
  }

  async function indexExistingConvertedFiles() {
    const documentNames = selectedExistingUnindexedFiles.map((filename) => convertedFileStatuses[filename]?.documentName).filter((value): value is string => Boolean(value));
    if (documentNames.length === 0) {
      setMessage(isEnglish ? "Select existing unindexed files first." : "Önce mevcut ve indekslenmemiş dosyaları seçin.");
      return;
    }
    setIsIndexing(true);
    setMessage("");
    setIndexingProgress({ completed: 0, total: documentNames.length });
    try {
      const response = await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(workspaceSlug)}/reindex-batch`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ documentNames }) });
      const body = await response.json() as { operationId?: string; error?: string };
      if (!response.ok || !body.operationId) throw new Error(body.error ?? "Indexing could not be started.");
      setBatchOperationId(body.operationId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : isEnglish ? "Indexing failed." : "İndeksleme başarısız.");
      setIsIndexing(false);
      setIndexingProgress({ completed: 0, total: 0 });
    }
  }

  function keepOnlyNewFiles() {
    void setSelectedMarkdownFiles(markdownFiles.filter((_, index) => fileStatuses[index] === "NEW"));
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

  function conflictLabel(status: UploadConflictStatus | "INDEXED") {
    if (status === "INDEXED") return isEnglish ? "Indexed" : "İndekslendi";
    if (status === "DUPLICATE") return isEnglish ? "Already exists" : "Zaten mevcut";
    if (status === "CONFLICT") return isEnglish ? "Same name, different content" : "Aynı ad, farklı içerik";
    return isEnglish ? "New" : "Yeni";
  }

  function conflictIcon(status: UploadConflictStatus | "INDEXED") {
    if (status === "INDEXED") return <i className="pi pi-check-circle" />;
    if (status === "DUPLICATE") return <i className="pi pi-copy" />;
    if (status === "CONFLICT") return <i className="pi pi-exclamation-triangle" />;
    return <i className="pi pi-plus-circle" />;
  }

  async function uploadDocuments() {
    if (markdownFiles.length === 0) {
      setMessage(isEnglish ? "No Markdown file selected." : "Markdown dosyası seçilmedi.");
      return;
    }

    setIsUploading(true);
    setMessage("");
    const fileNames = markdownFiles.map((file) => file.name);
    setUploadingFileNames(fileNames);
    writeUploadOperation({ workspaceSlug, status: "uploading", fileNames });
    const controller = new AbortController();
    operationAbortController.current = controller;

    const formData = new FormData();
    formData.append("workspaceSlug", workspaceSlug);
    markdownFiles.forEach((file) => formData.append("markdown", file));

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/documents/${markdownFiles.length === 1 ? "upload" : "upload-batch"}`,
        { method: "POST", body: formData, signal: controller.signal }
      );
      const body = await response.json();

      if (!response.ok) {
        clearUploadOperation();
        setMessage(body.error ?? (isEnglish ? "Upload failed." : "Yükleme başarısız."));
        return;
      }

      const documents: UploadedDocument[] = markdownFiles.length === 1 ? [body] : body.documents;
      setUploadedDocuments(documents);
      writeUploadOperation({ workspaceSlug, status: "uploaded", fileNames, documents });
      await indexUploadedDocuments(documents);
      setMessage(isEnglish ? `${documents.length} document(s) uploaded and ready to index.` : `${documents.length} belge yüklendi. İndeksleme için hazır.`);
    } catch (error) {
      clearUploadOperation();
      setMessage(error instanceof DOMException && error.name === "AbortError"
        ? (isEnglish ? "Upload cancelled." : "Yükleme iptal edildi.")
        : (isEnglish ? "Upload failed." : "Yükleme başarısız."));
    } finally {
      if (operationAbortController.current === controller) operationAbortController.current = null;
      setIsUploading(false);
    }
  }

  async function indexUploadedDocuments(documentsToIndex = uploadedDocuments) {
    if (documentsToIndex.length === 0) {
      setMessage(isEnglish ? "Upload a Markdown file first." : "Önce Markdown dosyasını yükle.");
      return;
    }

    setIsIndexing(true);
    setMessage("");
    setIndexingProgress({ completed: 0, total: documentsToIndex.length });

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/documents/${encodeURIComponent(workspaceSlug)}/reindex-batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ documentNames: documentsToIndex.map((document) => document.documentName), mode: "automatic" })
        }
      );
      const body = await response.json() as { operationId?: string; error?: string };
      if (!response.ok || !body.operationId) throw new Error(body.error ?? "Indexing could not be started.");
      setBatchOperationId(body.operationId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : isEnglish ? "Indexing failed." : "İndeksleme başarısız.");
      setIsIndexing(false);
      setIndexingProgress({ completed: 0, total: 0 });
    }
  }

  async function cancelCurrentOperation() {
    if (isEmbedding && embeddingOperation?.id) {
      await fetch(`${apiBaseUrl}/api/operations/${encodeURIComponent(embeddingOperation.id)}`, { method: "DELETE" });
      return;
    }
    if (batchOperationId) {
      try {
        await fetch(`${apiBaseUrl}/api/documents/reindex-batches/${encodeURIComponent(batchOperationId)}`, { method: "DELETE" });
        setMessage(isEnglish ? "Cancellation requested..." : "İptal isteği gönderildi...");
      } catch {
        setMessage(isEnglish ? "Cancellation request failed." : "İptal isteği gönderilemedi.");
      }
      return;
    }
    operationAbortController.current?.abort();
  }

  return (
    <section className="upload-grid">
      <div className="panel upload-panel upload-card">
        <div className="upload-heading">
          <div>
            <p className="eyebrow">{isEnglish ? "Upload" : "Yükle"}</p>
            <h3>{isEnglish ? "Markdown working copy" : "Markdown çalışma kopyası"}</h3>
          </div>
          <div className="upload-heading__actions">
          <OperationStatusButton workspaceSlug={workspaceSlug} />
          <AButton type="button" tone="secondary" onClick={() => setShowOcrHelp(true)}>
            {isEnglish ? "Open OCR help" : "OCR yardımını aç"}
          </AButton>
          </div>
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

          {uploadedDocuments.length > 0 || isIndexing || isEmbedding ? (
            <ul className="upload-selected-files upload-selected-files--status" aria-label={isEnglish ? "Document processing status" : "Belge işlem durumları"}>
              {uploadedDocuments.map((document, index) => {
                const completed = indexedDocumentNames.includes(document.documentName) || index < indexingProgress.completed;
                const current = isIndexing && index === indexingProgress.completed;
                const embedding = completed ? embeddingRowState(document.documentName) : null;
                const status = embedding?.label ?? (current ? (isEnglish ? "Indexing" : "İndeksleniyor") : (isEnglish ? "Waiting" : "Bekliyor"));
                const statusClass = embedding?.className || (current ? "is-running" : undefined);
                return <li key={document.documentName}><span>{document.documentName}</span><b className={statusClass}>{status}</b></li>;
              })}
            </ul>
          ) : markdownFiles.length > 0 || uploadingFileNames.length > 0 ? (
            <ul className="upload-selected-files" aria-label={isEnglish ? "Selected Markdown files" : "Seçilen Markdown dosyaları"}>
              {(markdownFiles.length > 0 ? markdownFiles.map((file) => file.name) : uploadingFileNames).map((fileName) => <li key={fileName}>{fileName}</li>)}
            </ul>
          ) : null}

          <AButton className="upload-submit" type="button" onClick={uploadDocuments} disabled={isUploading || isIndexing || isEmbedding || hasBlockedFiles} aria-label={isEnglish ? "Upload files" : "Dosyaları yükle"}>
            {isUploading ? (isEnglish ? "Uploading..." : "Yükleniyor...") : isEnglish ? "Upload Markdown files" : "Markdown dosyalarını yükle"}
          </AButton>
          <AButton className="upload-clear" type="button" tone="secondary" onClick={() => void clearUploadList()} disabled={isUploading || isIndexing || isEmbedding || (markdownFiles.length === 0 && uploadedDocuments.length === 0 && uploadingFileNames.length === 0)}>
            {isEnglish ? "Clear" : "Temizle"}
          </AButton>
          {isUploading || isIndexing || isEmbedding ? (
            <AButton className="upload-cancel" type="button" tone="secondary" onClick={cancelCurrentOperation} aria-label={isEnglish ? "Stop" : "Durdur"} title={isEnglish ? "Stop" : "Durdur"}>
              <i className="pi pi-stop-circle" aria-hidden="true" />
              {isEnglish ? "Stop current operation" : "Devam eden işlemi durdur"}
            </AButton>
          ) : null}
          {hasBlockedFiles ? <div className="form-message"><span>{isEnglish ? "Remove files that already exist or conflict before uploading." : "Yüklemeden önce zaten mevcut ya da çakışan dosyaları kaldırın."}</span><AButton type="button" tone="secondary" onClick={keepOnlyNewFiles}>{isEnglish ? "Keep only new files" : "Sadece yeni dosyaları tut"}</AButton></div> : null}
        </div>

      </div>

      <div className="panel converted-upload-card">
        <div className="converted-upload-picker">
          <div>
            <strong>{isEnglish ? "Use converted Markdown" : "Dönüştürülmüş Markdown kullan"}</strong>
            <p>{isEnglish ? "Choose files created on the File Conversion page and add them to this upload." : "Dosya Dönüştür sayfasında oluşturulan dosyaları bu yüklemeye ekleyin."}</p>
          </div>
          <div className="converted-upload-picker__filters" aria-label={isEnglish ? "Converted file filters" : "Dönüştürülmüş dosya filtreleri"}>
            {([
              ["all", isEnglish ? "All" : "Tümü"],
              ["unindexed", isEnglish ? "Not indexed" : "İndekslenmemiş"],
              ["indexed", isEnglish ? "Indexed" : "İndeksli"],
              ["conflict", isEnglish ? "Conflicts" : "Çakışanlar"]
            ] as Array<[ConvertedFileFilter, string]>).map(([filter, label]) => <AButton key={filter} type="button" tone="secondary" className={convertedFileFilter === filter ? "is-active" : undefined} onClick={() => setConvertedFileFilter(filter)}>{label}</AButton>)}
          </div>
          <div className="converted-upload-picker__files">
            {isLoadingConverted ? <span>{isEnglish ? "Loading..." : "Yükleniyor..."}</span> : null}
            {!isLoadingConverted && convertedFiles.length === 0 ? <span>{isEnglish ? "No converted Markdown files yet." : "Henüz dönüştürülmüş Markdown dosyası yok."}</span> : null}
            {!isLoadingConverted && filteredConvertedUploadFiles.length === 0 ? <span>{isEnglish ? "No files match this filter." : "Bu filtreyle eşleşen dosya yok."}</span> : null}
            {filteredConvertedUploadFiles.map((file) => {
              const fileStatus = convertedFileStatuses[file.filename];
              const status = fileStatus?.indexed ? "INDEXED" as const : fileStatus?.status;
              return <label key={file.filename}><input type="checkbox" checked={selectedConvertedFiles.includes(file.filename)} onChange={(event) => setSelectedConvertedFiles((current) => event.target.checked ? [...current, file.filename] : current.filter((filename) => filename !== file.filename))} /><span className="converted-upload-picker__filename">{file.filename}</span>{status ? <AIcon className={`upload-conflict upload-conflict--${status.toLowerCase()}`} icon={conflictIcon(status)} tooltip={conflictLabel(status)} /> : <AIcon className="converted-upload-picker__status-check" icon={<i className="pi pi-spinner pi-spin" />} tooltip={isCheckingConvertedStatuses ? (isEnglish ? "Checking file status" : "Dosya durumu kontrol ediliyor") : (isEnglish ? "File status unavailable" : "Dosya durumu alınamadı")} />}</label>;
            })}
          </div>
          {convertedUploadFiles.some((file) => {
            const status = convertedFileStatuses[file.filename];
            return status?.status === "DUPLICATE" && !status.indexed;
          }) ? <div className="converted-upload-picker__index-actions">
            <span>{isEnglish ? "Existing files that are not indexed can be selected and indexed without uploading again." : "Mevcut fakat indekslenmemiş dosyaları yeniden yüklemeden seçip indeksleyin."}</span>
            <div className="converted-upload-picker__actions">
              <AButton type="button" tone="secondary" onClick={selectExistingUnindexedFiles} disabled={isAddingConvertedFiles || isIndexing}>
                {isEnglish ? "Select unindexed existing" : "Mevcut indekslenmemişleri seç"}
              </AButton>
              <AButton type="button" onClick={() => void indexExistingConvertedFiles()} disabled={isAddingConvertedFiles || isIndexing || selectedExistingUnindexedFiles.length === 0}>
                {isEnglish ? "Index selected existing" : "Seçili mevcutları indeksle"}
              </AButton>
            </div>
          </div> : null}
          {isAddingConvertedFiles ? <p className="form-message">{isEnglish ? `Adding ${addingConvertedFileCount} of ${selectedUploadableConvertedFiles.length} files...` : `${selectedUploadableConvertedFiles.length} dosyadan ${addingConvertedFileCount} tanesi ekleniyor...`}</p> : null}
          {convertedUploadFiles.length > 0 ? <div className="converted-upload-picker__actions"><AButton type="button" tone="secondary" onClick={selectAllConvertedFiles} disabled={isAddingConvertedFiles}>{isEnglish ? "Select all" : "Tümünü seç"}</AButton><AButton type="button" tone="secondary" onClick={() => setSelectedConvertedFiles([])} disabled={isAddingConvertedFiles || selectedConvertedFiles.length === 0}>{isEnglish ? "Clear selection" : "Seçimi temizle"}</AButton><AButton type="button" tone="secondary" onClick={() => void addConvertedFiles()} disabled={isAddingConvertedFiles || selectedUploadableConvertedFiles.length === 0}>{isAddingConvertedFiles ? (isEnglish ? "Adding files..." : "Dosyalar ekleniyor...") : (isEnglish ? "Add selected files" : "Seçilen dosyaları yüklemeye ekle")}</AButton></div> : null}
        </div>
      </div>

      {false && (uploadedDocuments.length > 0 || isIndexing) ? (
          <div className="upload-index-panel">
            <div>
              <strong>{isIndexing && uploadedDocuments.length === 0 ? (isEnglish ? "Background indexing" : "Arka plan indeksleme işlemi") : `${uploadedDocuments.length} ${isEnglish ? "document(s)" : "belge"}`}</strong>
              {uploadedDocuments.length > 0 ? <span>{uploadedDocuments.map((document) => document.documentName).join(", ")}</span> : null}
            </div>
            <div className="button-row">
              <AButton
                type="button"
                tone="secondary"
                onClick={() => indexUploadedDocuments()}
                disabled={isIndexing || isUploading}
              >
                {isIndexing ? (isEnglish ? "Indexing..." : "İndeksleniyor...") : isEnglish ? "Index" : "İndeksle"}
              </AButton>
              <AButton
                type="button"
                onClick={() => indexUploadedDocuments()}
                disabled={isIndexing || isUploading}
              >
                {isEnglish ? "Index with LLM" : "LLM ile indeksle"}
              </AButton>
            </div>
            {isIndexing ? <span className="upload-index-progress">{isEnglish ? `Indexing ${indexingProgress.completed} of ${indexingProgress.total}` : `${indexingProgress.total} belgeden ${indexingProgress.completed} tanesi indekslendi`}</span> : null}
          </div>
      ) : null}

      {message ? <p className="form-message upload-message">{message}</p> : null}

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
            <h3 className="preview-document__filename"><i className="pi pi-file" aria-hidden="true" />{markdownFiles[previewFileIndex]?.name ?? (isEnglish ? "File preview" : "Dosya önizlemesi")}</h3>
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

function readUploadOperation(): PersistedUploadOperation | null {
  return null;
}

function writeUploadOperation(_operation: PersistedUploadOperation) {
  // Persistent operation state is maintained by the API, not browser storage.
}

function clearUploadOperation() {
  window.sessionStorage.removeItem(uploadOperationStorageKey);
}
