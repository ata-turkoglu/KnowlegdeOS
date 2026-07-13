"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "primereact/tooltip";
import { AButton, ADialog, AIcon } from "../components/ui";
import { useWorkspace } from "./workspace-context";
import { useLanguage } from "./language-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type DocumentItem = {
  documentName: string;
  workspaceSlug: string;
  filename: string;
  title: string;
  status: "UPLOADED" | "INDEXED";
  indexedAt: string | null;
  chunkCount: number;
  entityCount: number;
  hasLlmExtraction: boolean;
  llmExtractionError: string | null;
};

type DocumentDetail = DocumentItem & {
  hash: string;
  summary: string | null;
  markdown: string;
  chunks: Array<{
    chunkIndex: number;
    heading: string;
    tokenCount: number;
    content: string;
  }>;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
    source: string;
    evidenceSnippet: string;
  }>;
};

type ReindexOperation = {
  stage: string;
  status: "running" | "completed" | "cancelled" | "failed";
};

function formatIndexedAt(value: string | null, language: "tr" | "en") {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language === "en" ? "en-US" : "tr-TR", {
      dateStyle: "medium",
        timeStyle: "short",
        hourCycle: "h23"
      }).format(date);
}

const entityTypeLabels: Record<string, string> = {
  PERSON: "Kişi",
  PLACE: "Yer",
  PARCEL: "Parsel",
  DATE: "Tarih",
  ORGANIZATION: "Kurum",
  DOCUMENT_TYPE: "Belge türü",
  CASE_NUMBER: "Dava numarası",
  NOTARY_NUMBER: "Noter numarası",
  PROPERTY: "Taşınmaz",
  EVENT: "Olay"
};

const entitySourceLabels: Record<string, string> = {
  REGEX: "Kural tabanlı",
  FRONTMATTER: "Belge bilgileri",
  LLM: "Yapay zekâ"
};

function formatEntityConfidence(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "percent",
    maximumFractionDigits: 0
  }).format(value);
}

function formatLlmExtractionError(error: string, isEnglish: boolean) {
  if (error === "This operation was aborted") {
    return isEnglish
      ? "AI extraction timed out. The document was indexed, but its AI summary and entities were not created."
      : "Yapay zekâ çıkarımı zaman aşımına uğradı. Belge indekslendi; ancak yapay zekâ özeti ve yapay zekâ varlıkları oluşturulamadı.";
  }

  if (error === "LLM extraction cancelled by user.") {
    return isEnglish
      ? "AI extraction was cancelled. The document was indexed without an AI summary or AI entities."
      : "Yapay zekâ çıkarımı iptal edildi. Belge, yapay zekâ özeti ve yapay zekâ varlıkları olmadan indekslendi.";
  }

  return error;
}

function formatReindexStage(stage: string, isEnglish: boolean) {
  const stages: Record<string, [string, string]> = {
    "Starting reindexing": ["Yeniden indeksleme başlatılıyor", "Starting reindexing"],
    "Preparing document": ["Belge hazırlanıyor", "Preparing document"],
    "Waiting for AI response": ["Yapay zekâ yanıtı bekleniyor", "Waiting for AI response"],
    "Saving index": ["İndeks kaydediliyor", "Saving index"],
    "Updating entity index": ["Varlık indeksi güncelleniyor", "Updating entity index"],
    Completed: ["Tamamlandı", "Completed"],
    Cancelled: ["İptal edildi", "Cancelled"],
    "Reindexing failed": ["Yeniden indeksleme başarısız", "Reindexing failed"]
  };

  return stages[stage]?.[isEnglish ? 1 : 0] ?? stage;
}

const reindexStages = [
  "Preparing document",
  "Waiting for AI response",
  "Saving index",
  "Updating entity index"
];

function getReindexStageIndex(stage: string) {
  if (stage === "Completed") {
    return reindexStages.length;
  }

  return reindexStages.indexOf(stage);
}

export function DocumentsPanel() {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [message, setMessage] = useState(isEnglish ? "Loading..." : "Yükleniyor...");
  const [isLoading, setIsLoading] = useState(false);
  const [activeDocument, setActiveDocument] = useState("");
  const [pendingCancellation, setPendingCancellation] = useState<string | null>(null);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const [reindexStage, setReindexStage] = useState("");
  const [showMarkdownDialog, setShowMarkdownDialog] = useState(false);
  const reindexAbortController = useRef<AbortController | null>(null);

  async function loadDocuments(nextWorkspaceSlug = workspaceSlug) {
    setIsLoading(true);
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/documents?workspaceSlug=${encodeURIComponent(
        nextWorkspaceSlug
      )}`
    );
    const body = await response.json();

    setIsLoading(false);

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Document list could not be loaded." : "Belge listesi alınamadı."));
      return;
    }

    setDocuments(body);
    setMessage(isEnglish ? `${body.length} document(s) listed.` : `${body.length} belge listelendi.`);

    if (body.length > 0) {
      await loadDocumentDetail(body[0].documentName, nextWorkspaceSlug);
    } else {
      setSelectedDocument(null);
    }
  }

  async function loadDocumentDetail(
    documentName: string,
    nextWorkspaceSlug = workspaceSlug
  ) {
    setActiveDocument(documentName);
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/documents/${encodeURIComponent(
        nextWorkspaceSlug
      )}/${encodeURIComponent(documentName)}`
    );
    const body = await response.json();

    setActiveDocument("");

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Document details could not be loaded." : "Belge detayı alınamadı."));
      return;
    }

    setSelectedDocument(body);
  }

  async function reindexDocument(documentName: string, useLlm: boolean) {
    const controller = new AbortController();
    const operationId = crypto.randomUUID();
    reindexAbortController.current = controller;
    setActiveOperationId(operationId);
    setReindexStage("Starting reindexing");
    setActiveDocument(documentName);
    setMessage("");

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/documents/${encodeURIComponent(
          workspaceSlug
        )}/${encodeURIComponent(documentName)}/reindex`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-Reindex-Operation-Id": operationId
          },
          signal: controller.signal,
          body: JSON.stringify({ useLlm })
        }
      );
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error ?? (isEnglish ? "Reindexing failed." : "Yeniden indeksleme başarısız."));
        return;
      }

      setMessage(isEnglish ? `${documentName} reindexed.` : `${documentName} yeniden indekslendi.`);
      await loadDocuments(workspaceSlug);
      await loadDocumentDetail(documentName, workspaceSlug);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage(isEnglish ? "Reindexing cancelled." : "Yeniden indeksleme iptal edildi.");
      } else {
        setMessage(isEnglish ? "Reindexing failed." : "Yeniden indeksleme başarısız.");
      }
    } finally {
      if (reindexAbortController.current === controller) {
        reindexAbortController.current = null;
        setActiveOperationId(null);
        setActiveDocument("");
      }
    }
  }

  function cancelReindexing() {
    reindexAbortController.current?.abort();
    setPendingCancellation(null);
  }

  useEffect(() => {
    void loadDocuments(workspaceSlug);
  }, [workspaceSlug]);

  useEffect(() => {
    if (!activeOperationId) {
      return;
    }

    let cancelled = false;

    async function loadOperationStatus() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/reindex-operations/${activeOperationId}`);

        if (!response.ok || cancelled) {
          return;
        }

        const operation = (await response.json()) as ReindexOperation;
        setReindexStage(operation.stage);
      } catch {
        // The reindex request itself remains the source of truth for errors.
      }
    }

    void loadOperationStatus();
    const interval = window.setInterval(() => void loadOperationStatus(), 700);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeOperationId]);

  return (
    <section className="panel documents-panel">
      <div className="documents-panel-header">
        <div>
          <p className="eyebrow">Belge yönetimi</p>
          <h3>{isEnglish ? "Documents" : "Belgeler"}</h3>
        </div>

        <div className="documents-toolbar">
          <AButton type="button" onClick={() => loadDocuments()} disabled={isLoading}>
            {isLoading ? (isEnglish ? "Loading..." : "Yükleniyor...") : isEnglish ? "Refresh" : "Yenile"}
          </AButton>
        </div>
      </div>

      <div className="documents-layout">
        <div className="document-list">
          {documents.map((document) => (
            <article
              key={document.documentName}
              className={selectedDocument?.documentName === document.documentName ? "document-row is-selected" : "document-row"}
            >
              <div className="document-row-heading">
                <div>
                  <strong>{document.filename}</strong>
                  <span>
                    {document.title && document.title !== document.filename
                      ? document.title
                      : document.documentName}
                  </span>
                </div>
                {document.indexedAt ? (
                  <span className="document-meta">{formatIndexedAt(document.indexedAt, language)}</span>
                ) : null}
              </div>

              <div className="document-row-footer">
                <div className="document-stats">
                  <span><AIcon icon={<i className="pi pi-check-circle" />} tooltip={document.status} /></span>
                  <span><AIcon icon={<i className="pi pi-align-left" />} tooltip={`${document.chunkCount} ${isEnglish ? "document sections" : "belge bölümü"}`} /></span>
                  <span><AIcon icon={<i className="pi pi-tags" />} tooltip={`${document.entityCount} ${isEnglish ? "entities" : "varlık"}`} /></span>
                  <span><AIcon icon={<i className={`pi ${document.hasLlmExtraction ? "pi-sparkles" : "pi-equals"}`} />} tooltip={document.hasLlmExtraction ? "LLM" : isEnglish ? "Rule-based" : "Kural tabanlı"} /></span>
                  {document.llmExtractionError ? (
                    <span>
                      <AIcon
                        className="document-warning-icon"
                        icon={<i className="pi pi-exclamation-triangle" />}
                        tooltip={formatLlmExtractionError(document.llmExtractionError, isEnglish)}
                      />
                    </span>
                  ) : null}
                </div>
                <div className="document-actions">
                  {activeDocument === document.documentName ? (
                    <div className="document-processing">
                      <div className="document-processing-status">
                        <span><i className="pi pi-spin pi-spinner" aria-hidden="true" /> {formatReindexStage(reindexStage || "Starting reindexing", isEnglish)}</span>
                        <ol className="document-processing-steps" aria-label={isEnglish ? "Reindexing progress" : "Yeniden indeksleme ilerlemesi"}>
                          {reindexStages.map((stage, index) => {
                            const currentStageIndex = getReindexStageIndex(reindexStage);
                            const isComplete = currentStageIndex > index;
                            const isCurrent = currentStageIndex === index;

                            return (
                              <li key={stage} className={isComplete ? "is-complete" : isCurrent ? "is-current" : undefined}>
                                {isComplete ? <i className="pi pi-check" aria-hidden="true" /> : null}
                                {formatReindexStage(stage, isEnglish)}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                      <AButton
                        className="document-cancel p-button-outlined"
                        type="button"
                        tone="secondary"
                        onClick={() => setPendingCancellation(document.documentName)}
                        aria-label={isEnglish ? "Cancel reindexing" : "Yeniden indekslemeyi iptal et"}
                        title={isEnglish ? "Cancel reindexing" : "Yeniden indekslemeyi iptal et"}
                      >
                        <i className="pi pi-times" aria-hidden="true" />
                      </AButton>
                    </div>
                  ) : (
                    <>
                      <AButton
                        className={`document-index-tooltip-${document.documentName}`}
                        type="button"
                        tone="secondary"
                        onClick={() => reindexDocument(document.documentName, false)}
                        disabled={Boolean(activeDocument)}
                      >
                        {isEnglish ? "Index" : "İndeksle"}
                      </AButton>
                      <AButton
                        className={`document-llm-tooltip-${document.documentName}`}
                        type="button"
                        tone="secondary"
                        onClick={() => reindexDocument(document.documentName, true)}
                        disabled={Boolean(activeDocument)}
                      >
                        LLM
                      </AButton>
                      <Tooltip
                        target={`.document-index-tooltip-${document.documentName}`}
                        content={isEnglish ? "Rebuilds the document index with rule-based extraction." : "Belge indeksini kural tabanlı çıkarımla yeniden oluşturur."}
                        position="top"
                      />
                      <Tooltip
                        target={`.document-llm-tooltip-${document.documentName}`}
                        content={isEnglish ? "Uses AI to create a document summary and extract additional entities." : "Belge özeti ve ek varlıklar oluşturmak için yapay zekâ kullanır."}
                        position="top"
                      />
                      <AButton
                        className="document-detail-trigger"
                        type="button"
                        tone="secondary"
                        onClick={() => loadDocumentDetail(document.documentName)}
                        disabled={Boolean(activeDocument)}
                        aria-label={isEnglish ? "Open document details" : "Belge detayını aç"}
                        title={isEnglish ? "Open document details" : "Belge detayını aç"}
                      >
                        <i className="pi pi-arrow-right" aria-hidden="true" />
                      </AButton>
                    </>
                  )}
                </div>
              </div>

            </article>
          ))}

          {documents.length === 0 ? <p className="empty-state">{isEnglish ? "There are no documents in this workspace." : "Bu çalışma alanında belge yok."}</p> : null}
        </div>

        {selectedDocument ? (
        <div className="document-detail-panel">
          <div className="document-detail-heading">
            <div>
              <p className="eyebrow">{isEnglish ? "Preview" : "Önizleme"}</p>
              <strong>{selectedDocument.filename}</strong>
              <span>{selectedDocument.title}</span>
            </div>
            <div className="document-detail-actions">
              <span>{selectedDocument.hash.slice(0, 12)}</span>
              <AButton
                className="p-button-outlined"
                type="button"
                tone="secondary"
                onClick={() => setShowMarkdownDialog(true)}
              >
                <i className="pi pi-code" aria-hidden="true" />
                Markdown
              </AButton>
            </div>
          </div>

          {selectedDocument.summary ? (
            <p className="document-summary">
              <i className="pi pi-sparkles" aria-hidden="true" />
              {selectedDocument.summary}
            </p>
          ) : null}

          <div className="detail-grid">
            <section>
              <h4>{isEnglish ? "Document sections" : "Belge bölümleri"} ({selectedDocument.chunks.length})</h4>
              <div className="chunk-list">
                {selectedDocument.chunks.map((chunk) => (
                  <article key={chunk.chunkIndex}>
                    <div className="chunk-heading">
                      <strong>
                        #{chunk.chunkIndex} {chunk.heading}
                      </strong>
                      <span>{chunk.tokenCount} token</span>
                    </div>
                    <p>{chunk.content}</p>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <h4>{isEnglish ? "Extracted information" : "Belgeden çıkarılan bilgiler"} ({selectedDocument.entities.length})</h4>
              <div className="detail-entity-list">
                {selectedDocument.entities.map((entity, index) => (
                  <article key={`${entity.type}-${entity.value}-${index}`}>
                    <strong>{entity.value}</strong>
                    <div className="detail-entity-meta">
                      <AIcon
                        icon={<i className="pi pi-tags" />}
                        tooltip={`${isEnglish ? "Type" : "Tür"}: ${entityTypeLabels[entity.type] ?? entity.type}`}
                      />
                      <AIcon
                        icon={<i className={`pi ${entity.source === "LLM" ? "pi-sparkles" : entity.source === "REGEX" ? "pi-equals" : "pi-file"}`} />}
                        tooltip={`${isEnglish ? "Source" : "Kaynak"}: ${entitySourceLabels[entity.source] ?? entity.source}`}
                      />
                      <AIcon
                        icon={<i className="pi pi-chart-line" />}
                        tooltip={`${isEnglish ? "Confidence" : "Güven"}: ${formatEntityConfidence(entity.confidence)}`}
                      />
                    </div>
                    <p>{entity.evidenceSnippet}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
        ) : <div className="document-detail-panel empty-state">{isEnglish ? "Select a document to inspect." : "İncelemek için bir belge seç."}</div>}
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <ADialog
        visible={showMarkdownDialog}
        onHide={() => setShowMarkdownDialog(false)}
        header={isEnglish ? "Markdown" : "Markdown"}
        style={{ width: "min(960px, calc(100vw - 32px))" }}
      >
        <pre className="markdown-preview markdown-dialog-content">{selectedDocument?.markdown}</pre>
      </ADialog>

      <ADialog
        visible={pendingCancellation !== null}
        onHide={() => setPendingCancellation(null)}
        header={isEnglish ? "Cancel reindexing?" : "Yeniden indeksleme iptal edilsin mi?"}
        style={{ width: "min(420px, calc(100vw - 32px))" }}
        footer={
          <div className="chat-delete-dialog__actions">
            <AButton tone="secondary" onClick={() => setPendingCancellation(null)}>
              {isEnglish ? "Keep running" : "Devam et"}
            </AButton>
            <AButton className="chat-delete-dialog__confirm" onClick={cancelReindexing}>
              {isEnglish ? "Cancel operation" : "İşlemi iptal et"}
            </AButton>
          </div>
        }
      >
        <p className="chat-delete-dialog__text">
          {isEnglish
            ? `Cancel reindexing for “${pendingCancellation ?? ""}”?`
            : `“${pendingCancellation ?? ""}” için yeniden indeksleme işlemi iptal edilsin mi?`}
        </p>
      </ADialog>
    </section>
  );
}
