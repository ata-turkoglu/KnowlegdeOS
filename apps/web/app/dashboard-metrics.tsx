"use client";

import { useEffect, useState } from "react";
import { AButton } from "../components/ui";
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
  const { workspaceSlug } = useWorkspace();
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [status, setStatus] = useState("Yukleniyor...");
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
      setStatus(body.error ?? "Dashboard bilgisi alinamadi.");
      return;
    }

    setSummary(body);
    setStatus(`Guncellendi: ${body.workspaceSlug}`);
  }

  useEffect(() => {
    void loadSummary(workspaceSlug);
  }, [workspaceSlug]);

  return (
    <section className="dashboard-panel" aria-label="Archive summary">
      <div className="dashboard-toolbar">
        <AButton type="button" onClick={() => loadSummary()} disabled={isLoading}>
          {isLoading ? "Yukleniyor..." : "Yenile"}
        </AButton>
      </div>

      <div className="metrics">
        <div>
          <span>Workspace</span>
          <strong>{summary.workspaceCount}</strong>
        </div>
        <div>
          <span>Belge</span>
          <strong>{summary.documentCount}</strong>
          <small>{summary.indexedDocumentCount} indeksli</small>
        </div>
        <div>
          <span>Entity</span>
          <strong>{summary.entityCount}</strong>
        </div>
        <div>
          <span>Indeks</span>
          <strong>{summary.chunkCount}</strong>
          <small>{summary.embeddingCount} embedding</small>
        </div>
      </div>

      {status ? <p className="form-message">{status}</p> : null}
    </section>
  );
}
