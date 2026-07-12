"use client";

import { useState } from "react";
import { AButton, AInput } from "../components/ui";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type SearchMode = "entity" | "semantic" | "hybrid";

type Source = {
  documentName: string;
  title: string;
  evidenceSnippet: string;
  matchedAliases?: string[];
  sourceType?: "ENTITY" | "SEMANTIC";
  score?: number;
};

type SearchDocument = {
  documentName: string;
  title: string;
  entityMatched?: boolean;
  semanticScore?: number | null;
  evidenceSnippet: string;
};

type SearchResponse = {
  queryType: string;
  query: string;
  matchedEntity?: {
    canonicalValue: string;
    type: string;
  } | null;
  matchedAliases?: Array<{
    alias: string;
  }>;
  retrievedDocuments?: SearchDocument[];
  results?: Array<{
    documentName: string;
    title: string;
    chunkIndex: number;
    heading: string | null;
    score: number;
    snippet: string;
  }>;
  documents?: SearchDocument[];
  sources: Source[];
  semantic?: {
    embeddingModel: string;
    results: SearchResponse["results"];
  };
};

export function SearchPanel() {
  const { workspaceSlug } = useWorkspace();
  const [query, setQuery] = useState("Ali Cobanoglu gecen belgeleri ozetle");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [limit, setLimit] = useState(5);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function runSearch() {
    if (!query.trim()) {
      setMessage("Arama sorgusu bos olamaz.");
      return;
    }

    setIsBusy(true);
    setMessage("");

    const endpoint =
      mode === "entity"
        ? "/api/search/entity"
        : mode === "semantic"
          ? "/api/search/semantic"
          : "/api/search/hybrid";
    const result = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        workspaceSlug,
        query,
        limit
      })
    });
    const body = await result.json();

    setIsBusy(false);

    if (!result.ok) {
      setMessage(body.error ?? "Arama basarisiz.");
      return;
    }

    setResponse(body);
    setMessage(`${body.queryType} sonucu yuklendi.`);
  }

  async function rebuildSemanticIndex() {
    setIsBusy(true);
    setMessage("");

    const result = await fetch(`${apiBaseUrl}/api/search/semantic/rebuild`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ workspaceSlug })
    });
    const body = await result.json();

    setIsBusy(false);

    if (!result.ok) {
      setMessage(body.error ?? "Semantic index yenilenemedi.");
      return;
    }

    setMessage(`${body.chunks.length} chunk icin semantic index yenilendi.`);
  }

  const documents: SearchDocument[] =
    response?.documents ??
    response?.retrievedDocuments ??
    response?.results?.map((result) => ({
      documentName: result.documentName,
      title: result.title,
      entityMatched: false,
      semanticScore: result.score,
      evidenceSnippet: result.snippet
    })) ??
    [];

  return (
    <section className="panel search-panel">
      <div>
        <p className="eyebrow">Arama</p>
        <h3>Entity, semantic ve hybrid search</h3>
      </div>

      <div className="search-form">
        <label>
          Sorgu
          <AInput value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Limit
          <AInput
            min="1"
            max="10"
            type="number"
            value={String(limit)}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="search-controls">
        <div className="segmented-control" aria-label="Search mode">
          {(["entity", "semantic", "hybrid"] as SearchMode[]).map((item) => (
            <AButton
              key={item}
              type="button"
              tone={mode === item ? "primary" : "secondary"}
              className={mode === item ? "active" : ""}
              onClick={() => setMode(item)}
            >
              {item}
            </AButton>
          ))}
        </div>
        <AButton type="button" onClick={runSearch} disabled={isBusy}>
          {isBusy ? "Araniyor..." : "Ara"}
        </AButton>
        <AButton
          type="button"
          tone="secondary"
          onClick={rebuildSemanticIndex}
          disabled={isBusy}
        >
          Semantic rebuild
        </AButton>
      </div>

      {response ? (
        <div className="search-result-panel">
          <div className="result-strip">
            <span>Query Type</span>
            <strong>{response.queryType}</strong>
          </div>

          {response.matchedEntity ? (
            <div className="result-strip">
              <span>Matched Entity</span>
              <strong>{response.matchedEntity.canonicalValue}</strong>
            </div>
          ) : null}

          {response.semantic?.embeddingModel ? (
            <div className="result-strip">
              <span>Embedding</span>
              <strong>{response.semantic.embeddingModel}</strong>
            </div>
          ) : null}

          <div className="search-documents">
            {documents.map((document, index) => (
              <article key={`${document.documentName}-${index}`}>
                <div>
                  <strong>{document.documentName}</strong>
                  <span>{document.title}</span>
                </div>
                <div className="document-stats">
                  {document.entityMatched ? <span>ENTITY</span> : null}
                  {typeof document.semanticScore === "number" ? (
                    <span>{document.semanticScore.toFixed(3)}</span>
                  ) : null}
                </div>
                <p>{document.evidenceSnippet}</p>
              </article>
            ))}
          </div>

          <div className="source-list">
            {response.sources.map((source, index) => (
              <article key={`${source.documentName}-${source.sourceType ?? "source"}-${index}`}>
                <strong>{source.documentName}</strong>
                <span>
                  {source.title}
                  {source.sourceType ? ` · ${source.sourceType}` : ""}
                  {typeof source.score === "number" ? ` · ${source.score.toFixed(3)}` : ""}
                </span>
                <p>{source.evidenceSnippet}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
