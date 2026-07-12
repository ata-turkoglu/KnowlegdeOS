"use client";

import { useEffect, useState } from "react";
import { AButton } from "../components/ui";
import { useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type DashboardSummary = {
  workspaceSlug: string;
  workspaceCount: number;
  documentCount: number;
  indexedDocumentCount: number;
  entityCount: number;
  chunkCount: number;
  embeddingCount: number;
};

const emptySummary: DashboardSummary = {
  workspaceSlug: "merter-arsivi",
  workspaceCount: 0,
  documentCount: 0,
  indexedDocumentCount: 0,
  entityCount: 0,
  chunkCount: 0,
  embeddingCount: 0
};

export function DashboardMetrics() {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [status, setStatus] = useState(isEnglish ? "Loading..." : "Yükleniyor...");
  const [isLoading, setIsLoading] = useState(false);

  async function loadSummary(nextWorkspaceSlug = workspaceSlug) {
    setIsLoading(true);
    setStatus("");

    const response = await fetch(
      `${apiBaseUrl}/api/dashboard/summary?workspaceSlug=${encodeURIComponent(
        nextWorkspaceSlug
      )}`
    );
    const body = await response.json();

    setIsLoading(false);

    if (!response.ok) {
      setStatus(body.error ?? (isEnglish ? "Dashboard data could not be loaded." : "Dashboard bilgisi alınamadı."));
      return;
    }

    setSummary(body);
    setStatus(isEnglish ? `Updated: ${body.workspaceSlug}` : `Güncellendi: ${body.workspaceSlug}`);
  }

  useEffect(() => {
    void loadSummary(workspaceSlug);
  }, [workspaceSlug]);

  return (
    <section className="dashboard-panel" aria-label={isEnglish ? "Archive summary" : "Arsiv ozeti"}>
      <div className="dashboard-toolbar">
        <AButton type="button" onClick={() => loadSummary()} disabled={isLoading}>
          {isLoading ? (isEnglish ? "Loading..." : "Yükleniyor...") : isEnglish ? "Refresh" : "Yenile"}
        </AButton>
      </div>

      <div className="metrics">
        <div>
          <span>{isEnglish ? "Workspaces" : "Calisma alanlari"}</span>
          <strong>{summary.workspaceCount}</strong>
        </div>
        <div>
          <span>{isEnglish ? "Documents" : "Belgeler"}</span>
          <strong>{summary.documentCount}</strong>
          <small>{summary.indexedDocumentCount} {isEnglish ? "indexed" : "indeksli"}</small>
        </div>
        <div>
          <span>{isEnglish ? "Entities" : "Varliklar"}</span>
          <strong>{summary.entityCount}</strong>
        </div>
        <div>
          <span>{isEnglish ? "Index" : "İndeks"}</span>
          <strong>{summary.chunkCount}</strong>
          <small>{summary.embeddingCount} embedding</small>
        </div>
      </div>

      {status ? <p className="form-message">{status}</p> : null}
    </section>
  );
}
