"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "primereact/tooltip";
import { AButton, ADialog, AIcon } from "../components/ui";
import { useWorkspace } from "./workspace-context";
import { useLanguage } from "./language-context";
import { OperationStatusButton } from "./operation-status-dialog";

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

type EmbeddingCoverageItem = {
  documentName: string;
  status: "MISSING" | "READY";
};

type DocumentDetail = DocumentItem & {
  hash: string;
  summary: string | null;
  markdown: string;
  quality: { checkedChunkCount: number; issueCount: number; issues: Array<{ chunkIndex: number; code: "TOO_SHORT" | "DUPLICATE" | "OCR_ARTIFACTS" | "LOW_TEXT_DENSITY"; severity: "warning" | "error" }> };
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

type IndexingStageResult = {
  status: 'pending' | 'running' | 'succeeded' | 'succeeded_with_warnings' | 'failed' | 'skipped';
  execution: string;
  provider?: string;
  model?: string;
  acceptedCount?: number;
  rejectedCount?: number;
};

type DocumentFilter = "all" | "indexed" | "chunks" | "entities" | "llm";

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
  if (error.toLowerCase() === "fetch failed") {
    return isEnglish
      ? "AI extraction could not reach the configured model provider. The document was indexed, but its AI summary and entities were not created. Check that the provider and model are available, then run LLM indexing again."
      : "Yapay zekâ çıkarımı, yapılandırılmış model sağlayıcısına ulaşamadı. Belge indekslendi; ancak yapay zekâ özeti ve varlıkları oluşturulamadı. Sağlayıcı ile modelin erişilebilir olduğunu kontrol edip LLM indekslemeyi yeniden çalıştırın.";
  }

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

  if (error.startsWith("Expected ") || error.includes("JSON")) {
    return isEnglish
      ? "AI extraction returned incomplete structured data. Run LLM indexing again; if it repeats, use a smaller local model."
      : "Yapay zekâ çıkarımı eksik yapılandırılmış veri döndürdü. LLM indekslemeyi yeniden çalıştırın; tekrar ederse daha küçük bir yerel model kullanın.";
  }

  return isEnglish
    ? `AI extraction failed: ${error}`
    : `Yapay zekâ çıkarımı başarısız oldu: ${error}`;
}

function formatDocumentStatus(status: DocumentItem["status"], isEnglish: boolean) {
  if (status === "INDEXED") return isEnglish ? "Indexed" : "İndekslendi";
  return isEnglish ? "Uploaded" : "Yüklendi";
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

function indexingOutcome(stageResults: Record<string, IndexingStageResult> | undefined, isEnglish: boolean) {
  if (!stageResults) return '';
  const relevant = ['entities', 'aliases', 'relationships', 'claims', 'summary']
    .map((stage) => [stage, stageResults[stage]] as const)
    .filter((entry): entry is [string, IndexingStageResult] => Boolean(entry[1]));
  const failed = relevant.filter(([, stage]) => stage.status === 'failed').map(([stage]) => stage);
  const warnings = relevant.filter(([, stage]) => stage.status === 'succeeded_with_warnings').map(([stage]) => stage);
  if (failed.length) return isEnglish ? ` Failed stages: ${failed.join(', ')}.` : ` Başarısız aşamalar: ${failed.join(', ')}.`;
  if (warnings.length) return isEnglish ? ` Review needed: ${warnings.join(', ')}.` : ` İnceleme gerekli: ${warnings.join(', ')}.`;
  return isEnglish ? ` Stages: ${relevant.map(([stage, result]) => `${stage} (${result.execution})`).join(', ')}.` : ` Aşamalar: ${relevant.map(([stage, result]) => `${stage} (${result.execution})`).join(', ')}.`;
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
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Record<string, EmbeddingCoverageItem["status"]>>({});
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>("all");
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [message, setMessage] = useState(isEnglish ? "Loading..." : "Yükleniyor...");
  const [isLoading, setIsLoading] = useState(false);
  const [activeDocument, setActiveDocument] = useState("");
  const [pendingCancellation, setPendingCancellation] = useState<string | null>(null);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const [reindexStage, setReindexStage] = useState("");
  const [showMarkdownDialog, setShowMarkdownDialog] = useState(false);
  const reindexAbortController = useRef<AbortController | null>(null);
  const filteredDocuments = documents.filter((document) => {
    if (documentFilter === "indexed") return document.status === "INDEXED";
    if (documentFilter === "chunks") return document.chunkCount > 0;
    if (documentFilter === "entities") return document.entityCount > 0;
    if (documentFilter === "llm") return document.hasLlmExtraction;
    return true;
  });

  async function loadDocuments(nextWorkspaceSlug = workspaceSlug) {
    setIsLoading(true);
    setMessage("");

    const [response, embeddingResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/documents?workspaceSlug=${encodeURIComponent(nextWorkspaceSlug)}`),
      fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(nextWorkspaceSlug)}/embedding-coverage`)
    ]);
    const body = await response.json();
    const embeddingCoverage = embeddingResponse.ok ? await embeddingResponse.json() as EmbeddingCoverageItem[] : [];

    setIsLoading(false);

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Document list could not be loaded." : "Belge listesi alınamadı."));
      return;
    }

    setDocuments(body);
    setEmbeddingStatuses(Object.fromEntries(embeddingCoverage.map((item) => [item.documentName, item.status])));
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

  async function reindexDocument(documentName: string) {
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
          body: JSON.stringify({ mode: "automatic" })
        }
      );
      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error ?? (isEnglish ? "Reindexing failed." : "Yeniden indeksleme başarısız."));
        return;
      }

      setMessage((isEnglish ? `${documentName} reindexed.` : `${documentName} yeniden indekslendi.`) + indexingOutcome(body.stageResults, isEnglish));
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
          <h3>
            {isEnglish ? "Documents" : "Belgeler"}
            <span className="document-count" aria-label={isEnglish ? `${filteredDocuments.length} documents shown` : `${filteredDocuments.length} belge gösteriliyor`}>
              {documentFilter === "all" ? documents.length : `${filteredDocuments.length}/${documents.length}`}
            </span>
            <span className="document-filters" aria-label={isEnglish ? "Document filters" : "Belge filtreleri"}>
              {([
                ["all", "pi-list", isEnglish ? "All documents" : "Tüm belgeler"],
                ["indexed", "pi-check-circle", isEnglish ? "Indexed documents" : "İndekslenmiş belgeler"],
                ["chunks", "pi-align-left", isEnglish ? "Documents with sections" : "Bölümü olan belgeler"],
                ["entities", "pi-tags", isEnglish ? "Documents with entities" : "Varlığı olan belgeler"],
                ["llm", "pi-sparkles", isEnglish ? "AI extracted documents" : "Yapay zekâ çıkarımlı belgeler"]
              ] as const).map(([filter, icon, label]) => (
                <AButton
                  key={filter}
                  className={documentFilter === filter ? "document-filter is-active" : "document-filter p-button-outlined"}
                  type="button"
                  tone="secondary"
                  onClick={() => setDocumentFilter(filter)}
                  aria-label={label}
                  aria-pressed={documentFilter === filter}
                  title={label}
                >
                  <i className={`pi ${icon}`} aria-hidden="true" />
                </AButton>
              ))}
            </span>
          </h3>
        </div>

        <div className="documents-toolbar">
          <OperationStatusButton workspaceSlug={workspaceSlug} />
          <AButton type="button" onClick={() => loadDocuments()} disabled={isLoading}>
            {isLoading ? (isEnglish ? "Loading..." : "Yükleniyor...") : isEnglish ? "Refresh" : "Yenile"}
          </AButton>
        </div>
      </div>

      <div className="documents-layout">
        <div className="document-list">
          {filteredDocuments.map((document) => (
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
                  <span><AIcon icon={<i className="pi pi-check-circle" />} tooltip={formatDocumentStatus(document.status, isEnglish)} /></span>
                  <span><AIcon icon={<i className="pi pi-align-left" />} tooltip={`${document.chunkCount} ${isEnglish ? "document sections" : "belge bölümü"}`} /></span>
                  <span><AIcon icon={<i className="pi pi-tags" />} tooltip={`${document.entityCount} ${isEnglish ? "entities" : "varlık"}`} /></span>
                  <span><AIcon icon={<i className={`pi ${document.hasLlmExtraction ? "pi-sparkles" : "pi-equals"}`} />} tooltip={document.hasLlmExtraction ? "LLM" : isEnglish ? "Rule-based" : "Kural tabanlı"} /></span>
                  {document.status === "INDEXED" ? (
                    <span className={`document-embedding-status is-${(embeddingStatuses[document.documentName] ?? "MISSING").toLowerCase()}`}>
                      <AIcon
                        icon={<i className={`pi ${(embeddingStatuses[document.documentName] ?? "MISSING") === "READY" ? "pi-database" : "pi-clock"}`} />}
                        tooltip={(embeddingStatuses[document.documentName] ?? "MISSING") === "READY"
                          ? (isEnglish ? "Embedding created" : "Embedding oluşturuldu")
                          : (isEnglish ? "Waiting for embedding" : "Embedding bekliyor")}
                      />
                    </span>
                  ) : null}
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
                        onClick={() => reindexDocument(document.documentName)}
                        disabled={Boolean(activeDocument)}
                      >
                        {isEnglish ? "Index" : "İndeksle"}
                      </AButton>
                      <Tooltip
                        target={`.document-index-tooltip-${document.documentName}`}
                        content={isEnglish ? "Rebuilds the document index using automatic, stage-specific routing." : "Belge indeksini aşama bazlı otomatik yönlendirmeyle yeniden oluşturur."}
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
          {documents.length > 0 && filteredDocuments.length === 0 ? <p className="empty-state">{isEnglish ? "No documents match this filter." : "Bu filtreyle eşleşen belge yok."}</p> : null}
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

          {selectedDocument.quality.issueCount > 0 ? <section className="settings-note document-quality-report">
            <strong>{isEnglish ? "Index quality warnings" : "İndeks kalite uyarıları"}</strong>
            <p>{isEnglish ? `${selectedDocument.quality.issueCount} issue(s) across ${selectedDocument.quality.checkedChunkCount} sections.` : `${selectedDocument.quality.checkedChunkCount} bölümde ${selectedDocument.quality.issueCount} uyarı bulundu.`}</p>
            <p>{selectedDocument.quality.issues.map((issue) => `#${issue.chunkIndex}: ${issue.code}`).join(" · ")}</p>
          </section> : null}

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
                      <span>{chunk.tokenCount} {isEnglish ? "tokens" : "belirteç"}</span>
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
