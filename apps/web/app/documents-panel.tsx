"use client";

import { useEffect, useState } from "react";
import { AButton, AIcon } from "../components/ui";
import { useWorkspace } from "./workspace-context";

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

function formatIndexedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

export function DocumentsPanel() {
  const { workspaceSlug } = useWorkspace();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [message, setMessage] = useState("Yukleniyor...");
  const [isLoading, setIsLoading] = useState(false);
  const [activeDocument, setActiveDocument] = useState("");

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
      setMessage(body.error ?? "Belge listesi alinamadi.");
      return;
    }

    setDocuments(body);
    setMessage(`${body.length} belge listelendi.`);

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
      setMessage(body.error ?? "Belge detayi alinamadi.");
      return;
    }

    setSelectedDocument(body);
    setMessage(`${documentName} detayi yuklendi.`);
  }

  async function reindexDocument(documentName: string, useLlm: boolean) {
    setActiveDocument(documentName);
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/documents/${encodeURIComponent(
        workspaceSlug
      )}/${encodeURIComponent(documentName)}/reindex`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({ useLlm })
      }
    );
    const body = await response.json();

    setActiveDocument("");

    if (!response.ok) {
      setMessage(body.error ?? "Reindex basarisiz.");
      return;
    }

    setMessage(`${documentName} yeniden indekslendi.`);
    await loadDocuments(workspaceSlug);
    await loadDocumentDetail(documentName, workspaceSlug);
  }

  useEffect(() => {
    void loadDocuments(workspaceSlug);
  }, [workspaceSlug]);

  return (
    <section className="panel documents-panel">
      <div>
        <p className="eyebrow">Belge yonetimi</p>
        <h3>Documents</h3>
      </div>

      <div className="documents-toolbar">
        <AButton type="button" onClick={() => loadDocuments()} disabled={isLoading}>
          {isLoading ? "Yukleniyor..." : "Yenile"}
        </AButton>
      </div>

      <div className="documents-layout">
        <div className="document-list">
          {documents.map((document) => (
            <article key={document.documentName} className="document-row">
              <div className="document-row-heading">
                <div>
                  <strong>{document.filename}</strong>
                  <span>
                    {document.title && document.title !== document.filename
                      ? document.title
                      : document.documentName}
                  </span>
                </div>
              </div>

              <div className="document-row-footer">
                <div className="document-stats">
                  <span><AIcon icon={<i className="pi pi-check-circle" />} tooltip={document.status} /></span>
                  <span><AIcon icon={<i className="pi pi-align-left" />} tooltip={`${document.chunkCount} chunk`} /></span>
                  <span><AIcon icon={<i className="pi pi-tags" />} tooltip={`${document.entityCount} entity`} /></span>
                  <span><AIcon icon={<i className={`pi ${document.hasLlmExtraction ? "pi-sparkles" : "pi-cog"}`} />} tooltip={document.hasLlmExtraction ? "LLM" : "Deterministic"} /></span>
                </div>
                <div className="document-actions">
                  <AButton type="button" tone="secondary" onClick={() => loadDocumentDetail(document.documentName)} disabled={Boolean(activeDocument)}>
                    Detay
                  </AButton>
                  <AButton type="button" tone="secondary" onClick={() => reindexDocument(document.documentName, false)} disabled={Boolean(activeDocument)}>
                    {activeDocument === document.documentName ? "Isleniyor..." : "Reindex"}
                  </AButton>
                  <AButton type="button" onClick={() => reindexDocument(document.documentName, true)} disabled={Boolean(activeDocument)}>
                    LLM
                  </AButton>
                </div>
              </div>

              {document.indexedAt ? <p className="document-meta">{formatIndexedAt(document.indexedAt)}</p> : null}
              {document.llmExtractionError ? <p className="document-error">{document.llmExtractionError}</p> : null}
            </article>
          ))}

          {documents.length === 0 ? <p className="empty-state">Bu workspace icinde belge yok.</p> : null}
        </div>

        {selectedDocument ? (
        <div className="document-detail-panel">
          <div className="document-detail-heading">
            <div>
              <p className="eyebrow">Preview</p>
              <strong>{selectedDocument.filename}</strong>
              <span>{selectedDocument.title}</span>
            </div>
            <span>{selectedDocument.hash.slice(0, 12)}</span>
          </div>

          {selectedDocument.summary ? (
            <p className="document-summary">{selectedDocument.summary}</p>
          ) : null}

          <div className="detail-grid">
            <section>
              <h4>Chunks</h4>
              <div className="chunk-list">
                {selectedDocument.chunks.map((chunk) => (
                  <article key={chunk.chunkIndex}>
                    <strong>
                      #{chunk.chunkIndex} {chunk.heading}
                    </strong>
                    <span>{chunk.tokenCount} token</span>
                    <p>{chunk.content}</p>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <h4>Extracted entities</h4>
              <div className="detail-entity-list">
                {selectedDocument.entities.map((entity, index) => (
                  <article key={`${entity.type}-${entity.value}-${index}`}>
                    <strong>{entity.value}</strong>
                    <span>
                      {entity.type} · {entity.source} · {entity.confidence}
                    </span>
                    <p>{entity.evidenceSnippet}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section>
            <h4>Markdown</h4>
            <pre className="markdown-preview">{selectedDocument.markdown}</pre>
          </section>
        </div>
        ) : <div className="document-detail-panel empty-state">Incelemek icin bir belge sec.</div>}
      </div>

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
