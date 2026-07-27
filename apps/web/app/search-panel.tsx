"use client";

import { useState } from "react";
import { Tooltip } from "primereact/tooltip";
import { AButton, AIcon, AInfo, AInput } from "../components/ui";
import { useLanguage } from "./language-context";
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
  entity?: {
    matchedAliases?: Array<{
      alias: string;
    }>;
  };
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatches(text: string, terms: string[]) {
  const validTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].sort((left, right) => right.length - left.length);
  if (!validTerms.length) return text;

  const expression = new RegExp(`(${validTerms.map(escapeRegExp).join("|")})`, "giu");
  return text.split(expression).map((part, index) =>
    index % 2 === 1 ? <mark key={`${part}-${index}`}>{part}</mark> : part
  );
}

export function SearchPanel() {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [limit, setLimit] = useState(5);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [sourceContent, setSourceContent] = useState<Record<string, string>>({});
  const [loadingSource, setLoadingSource] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});

  async function runSearch() {
    if (!query.trim()) {
      setMessage(isEnglish ? "Search query cannot be empty." : "Arama sorgusu boş olamaz.");
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
      setMessage(body.error ?? (isEnglish ? "Search failed." : "Arama başarısız."));
      return;
    }

    setResponse(body);
    setExpandedSource(null);
    setSourceContent({});
    setSourceErrors({});
    setMessage(isEnglish ? `${body.queryType} results loaded.` : `${body.queryType} sonucu yüklendi.`);
  }

  async function toggleSource(documentName: string) {
    if (expandedSource === documentName) {
      setExpandedSource(null);
      return;
    }

    setExpandedSource(documentName);
    if (sourceContent[documentName] || loadingSource === documentName) return;

    setLoadingSource(documentName);
    setSourceErrors((current) => {
      const { [documentName]: _removed, ...remaining } = current;
      return remaining;
    });
    try {
      const result = await fetch(
        `${apiBaseUrl}/api/documents/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(documentName)}`
      );
      const body = await result.json() as { markdown?: string; error?: string };
      if (!result.ok) {
        throw new Error(body.error ?? (isEnglish ? "Document content could not be loaded." : "Belge içeriği yüklenemedi."));
      }
      setSourceContent((current) => ({ ...current, [documentName]: body.markdown ?? "" }));
    } catch (error) {
      setSourceErrors((current) => ({
        ...current,
        [documentName]: error instanceof Error ? error.message : (isEnglish ? "Document content could not be loaded." : "Belge içeriği yüklenemedi.")
      }));
    } finally {
      setLoadingSource(null);
    }
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

  const sourceDocuments = Array.from(
    (response?.sources ?? []).reduce<Map<string, { documentName: string; matchTypes: Array<"ENTITY" | "SEMANTIC"> }>>(
      (byDocument, source) => {
        const matchType = source.sourceType ?? (response?.queryType === "ENTITY_SEARCH" ? "ENTITY" : "SEMANTIC");
        const existing = byDocument.get(source.documentName);
        if (existing) {
          if (!existing.matchTypes.includes(matchType)) existing.matchTypes.push(matchType);
        } else {
          byDocument.set(source.documentName, { documentName: source.documentName, matchTypes: [matchType] });
        }
        return byDocument;
      },
      new Map()
    ).values()
  );
  const matchedAliases = response?.matchedAliases ?? response?.entity?.matchedAliases ?? [];
  const highlightTerms = matchedAliases.length > 0
    ? matchedAliases.map((alias) => alias.alias)
    : [response?.query ?? query];

  return (
    <section className="panel search-panel">
      <div>
        <p className="eyebrow">{isEnglish ? "Search" : "Arama"}</p>
        <h3>{isEnglish ? "Entity, semantic, and hybrid search" : "Varlık, anlamsal ve hibrit arama"}</h3>
      </div>

      <div className="search-workbench">
      <div className="search-form">
        <label>
          {isEnglish ? "Query" : "Sorgu"}
          <AInput
            value={query}
            placeholder={isEnglish ? "Search people, places, documents, or topics..." : "Kişi, yer, belge veya konu ara..."}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runSearch();
              }
            }}
          />
        </label>
        <label>
          <span className="label-with-info">
            Limit
            <AInfo
              description={isEnglish ? "The maximum number of best-matching documents and sources to return." : "Aramanın döndüreceği en iyi eşleşen belge ve kaynakların en fazla sayısı."}
            position="right"
            />
          </span>
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
        <div className="segmented-control" aria-label={isEnglish ? "Search mode" : "Arama modu"}>
          {(["entity", "semantic", "hybrid"] as SearchMode[]).map((item) => (
            <AButton
              key={item}
              type="button"
              tone={mode === item ? "primary" : "secondary"}
              className={`${mode === item ? "active " : ""}search-mode-${item}`}
              onClick={() => setMode(item)}
            >
              {item}
            </AButton>
          ))}
          <Tooltip
            target=".search-mode-entity"
            content={isEnglish ? "Matches your query against indexed entity names and aliases (people, places, organizations, etc.), then returns the documents where those entities occur. Best for exact names and known terms." : "Sorgunuzu indekslenmiş varlık adları ve takma adlarla (kişi, yer, kurum vb.) eşleştirir; ardından bu varlıkların geçtiği belgeleri getirir. Kesin isimler ve bilinen terimler için en uygunudur."}
            position="top"
          />
          <Tooltip
            target=".search-mode-semantic"
            content={isEnglish ? "Converts your query into an embedding and compares it with indexed document-section embeddings. It can find conceptually similar text even when the same words are not used." : "Sorgunuzu bir embedding’e dönüştürür ve belge bölümlerinin indekslenmiş embedding’leriyle karşılaştırır. Aynı kelimeler geçmese bile anlamca yakın metinleri bulabilir."}
            position="top"
          />
          <Tooltip
            target=".search-mode-hybrid"
            content={isEnglish ? "Runs entity and semantic search together, combines their document matches, and ranks the result set. Use it when you want both exact entity matches and meaning-based discovery." : "Varlık ve anlamsal aramayı birlikte çalıştırır, belge eşleşmelerini birleştirir ve sonuçları sıralar. Hem kesin varlık eşleşmelerini hem de anlam tabanlı keşfi istediğinizde kullanın."}
            position="top"
          />
        </div>
        <AButton type="button" onClick={runSearch} disabled={isBusy}>
          <i className="pi pi-search" aria-hidden="true" />
          {isBusy ? (isEnglish ? "Searching..." : "Aranıyor...") : isEnglish ? "Search" : "Ara"}
        </AButton>
      </div>
      </div>

      {response ? (
        <div className="search-result-panel">
          {response.matchedEntity ? (
            <div className="search-result-summary">
              <div className="result-strip">
                <span>{isEnglish ? "Matched entity" : "Eşleşen varlık"}</span>
                <strong>{response.matchedEntity.canonicalValue}</strong>
              </div>
            </div>
          ) : null}

          <div className="search-results-grid">
          <section className="search-result-section">
            <div className="search-section-heading">
              <h4>
                <i className="pi pi-file" aria-hidden="true" /> {isEnglish ? "Results" : "Sonuçlar"}
                <AInfo
                  description={isEnglish ? "The document sections that best match your search." : "Aramanızla en iyi eşleşen belge bölümleridir."}
                  position="top"
                />
              </h4>
              <span>{documents.length}</span>
            </div>
          <div className="search-documents">
            {documents.map((document, index) => (
              <article key={`${document.documentName}-${index}`}>
                <div>
                  <strong>{document.documentName}</strong>
                  <span>{document.title}</span>
                </div>
                <div className="document-stats">
                  {document.entityMatched ? (
                    <AIcon
                      icon={<i className="pi pi-equals" />}
                      tooltip={isEnglish ? "Exact match" : "Birebir eşleşme"}
                    />
                  ) : null}
                  {typeof document.semanticScore === "number" ? (
                    <>
                      <AIcon
                        icon={<i className="pi pi-sparkles" />}
                        tooltip={isEnglish ? "Semantic match" : "Anlamsal eşleşme"}
                      />
                      <AIcon
                        icon={<i className="pi pi-chart-line" />}
                        tooltip={`${isEnglish ? "Semantic score" : "Anlamsal skor"}: ${document.semanticScore.toFixed(3)}`}
                      />
                    </>
                  ) : null}
                </div>
                <p>{highlightMatches(document.evidenceSnippet, highlightTerms)}</p>
              </article>
            ))}
          </div>
          </section>

          <section className="search-result-section">
            <div className="search-section-heading">
              <h4>
                <i className="pi pi-link" aria-hidden="true" /> {isEnglish ? "Sources" : "Kaynaklar"}
                <AInfo
                  description={isEnglish ? "The original documents from which the results were retrieved." : "Sonuçların alındığı özgün belgelerdir."}
                  position="top"
                />
              </h4>
              <span>{sourceDocuments.length}</span>
            </div>
          <div className="source-list search-source-list">
            {sourceDocuments.map((source) => (
              <article key={source.documentName}>
                <button
                  type="button"
                  className="search-source-trigger"
                  onClick={() => void toggleSource(source.documentName)}
                  aria-expanded={expandedSource === source.documentName}
                >
                  <strong>{source.documentName}</strong>
                  <span className="search-source-icons">
                    {source.matchTypes.map((matchType) => (
                      <AIcon
                        key={matchType}
                        icon={<i className={matchType === "ENTITY" ? "pi pi-equals" : "pi pi-sparkles"} />}
                        tooltip={matchType === "ENTITY" ? (isEnglish ? "Exact match" : "Birebir eşleşme") : (isEnglish ? "Semantic match" : "Anlamsal eşleşme")}
                      />
                    ))}
                    <i className={`pi ${expandedSource === source.documentName ? "pi-chevron-up" : "pi-chevron-down"}`} aria-hidden="true" />
                  </span>
                </button>
                {expandedSource === source.documentName ? (
                  loadingSource === source.documentName ? (
                    <p className="search-source-content">{isEnglish ? "Loading document..." : "Belge yükleniyor..."}</p>
                  ) : sourceErrors[source.documentName] ? (
                    <p className="search-source-content">{sourceErrors[source.documentName]}</p>
                  ) : (
                    <pre className="search-source-content">{sourceContent[source.documentName]}</pre>
                  )
                ) : null}
              </article>
            ))}
          </div>
          </section>
          </div>
        </div>
      ) : null}

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
