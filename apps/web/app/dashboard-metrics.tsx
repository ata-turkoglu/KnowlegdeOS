"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  const { workspaceSlug, workspaces } = useWorkspace();
  const isEnglish = language === "en";
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const workspaceName = useMemo(
    () => workspaces.find((workspace) => workspace.slug === workspaceSlug)?.name ?? workspaceSlug,
    [workspaceSlug, workspaces]
  );
  const indexingProgress = summary.documentCount
    ? Math.round((summary.indexedDocumentCount / summary.documentCount) * 100)
    : 0;

  async function loadSummary(nextWorkspaceSlug = workspaceSlug) {
    setIsLoading(true);
    setStatus("");

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/dashboard/summary?workspaceSlug=${encodeURIComponent(nextWorkspaceSlug)}`
      );
      const body = await response.json();

      if (!response.ok) {
        setStatus(body.error ?? (isEnglish ? "Dashboard data could not be loaded." : "Panel verisi alınamadı."));
        return;
      }

      setSummary(body);
      setStatus(isEnglish ? "Just updated" : "Az önce güncellendi");
    } catch {
      setStatus(isEnglish ? "Dashboard data could not be loaded." : "Panel verisi alınamadı.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary(workspaceSlug);
  }, [workspaceSlug]);

  const copy = isEnglish
    ? {
        eyebrow: "Workspace overview", title: "Good to see you back", description: "Keep an eye on your archive and continue where you left off.", refresh: "Refresh", loading: "Loading…", workspaces: "Workspaces", documents: "Documents", entities: "Entities", index: "Index entries", indexed: "indexed", embeddings: "embeddings", health: "Archive health", healthDescription: "Document indexing coverage", ready: "ready to search", noDocuments: "Add your first document to start building the archive.", upload: "Upload documents", search: "Search archive", chat: "Ask the archive", quickActions: "Quick actions", quickActionsDescription: "Common tasks for this workspace.", openDocuments: "Review documents", status: "Status"
      }
    : {
        eyebrow: "Çalışma alanı özeti", title: "Tekrar hoş geldiniz", description: "Arşivinizin durumunu izleyin ve kaldığınız yerden devam edin.", refresh: "Yenile", loading: "Yükleniyor…", workspaces: "Çalışma alanları", documents: "Belgeler", entities: "Varlıklar", index: "İndeks kayıtları", indexed: "indeksli", embeddings: "embedding", health: "Arşiv durumu", healthDescription: "Belge indeksleme kapsamı", ready: "aramaya hazır", noDocuments: "Arşivinizi oluşturmaya başlamak için ilk belgenizi ekleyin.", upload: "Belge yükle", search: "Arşivde ara", chat: "Arşive sor", quickActions: "Hızlı işlemler", quickActionsDescription: "Bu çalışma alanındaki sık kullanılan işlemler.", openDocuments: "Belgeleri incele", status: "Durum"
      };

  return (
    <section className="dashboard-panel" aria-label={isEnglish ? "Archive dashboard" : "Arşiv paneli"}>
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="dashboard-hero__actions">
          <span className="dashboard-workspace"><i className="pi pi-folder" aria-hidden="true" />{workspaceName}</span>
          <AButton type="button" tone="secondary" onClick={() => loadSummary()} disabled={isLoading}>
            <i className={`pi ${isLoading ? "pi-spin pi-spinner" : "pi-refresh"}`} aria-hidden="true" />
            {isLoading ? copy.loading : copy.refresh}
          </AButton>
        </div>
      </header>

      <div className="metrics">
        <article className="metric-card metric-card--workspaces"><i className="pi pi-briefcase" aria-hidden="true" /><span>{copy.workspaces}</span><strong>{summary.workspaceCount}</strong></article>
        <article className="metric-card"><i className="pi pi-file" aria-hidden="true" /><span>{copy.documents}</span><strong>{summary.documentCount}</strong><small>{summary.indexedDocumentCount} {copy.indexed}</small></article>
        <article className="metric-card"><i className="pi pi-sitemap" aria-hidden="true" /><span>{copy.entities}</span><strong>{summary.entityCount}</strong><small>{copy.ready}</small></article>
        <article className="metric-card"><i className="pi pi-database" aria-hidden="true" /><span>{copy.index}</span><strong>{summary.chunkCount}</strong><small>{summary.embeddingCount} {copy.embeddings}</small></article>
      </div>

      <div className="dashboard-grid">
        <article className="dashboard-health">
          <div className="dashboard-section-heading"><div><span>{copy.status}</span><h2>{copy.health}</h2></div><strong>{indexingProgress}%</strong></div>
          <p>{summary.documentCount ? `${summary.indexedDocumentCount}/${summary.documentCount} ${copy.healthDescription.toLowerCase()}` : copy.noDocuments}</p>
          <div className="dashboard-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indexingProgress}><span style={{ width: `${indexingProgress}%` }} /></div>
          <div className="dashboard-health__footer"><span>{summary.indexedDocumentCount} {copy.indexed}</span><Link href="/documents">{copy.openDocuments}<i className="pi pi-arrow-right" aria-hidden="true" /></Link></div>
        </article>

        <article className="dashboard-actions">
          <div className="dashboard-section-heading"><div><span>{copy.status}</span><h2>{copy.quickActions}</h2></div></div>
          <p>{copy.quickActionsDescription}</p>
          <div className="dashboard-action-list">
            <Link href="/upload"><i className="pi pi-upload" aria-hidden="true" /><span>{copy.upload}</span><i className="pi pi-arrow-up-right" aria-hidden="true" /></Link>
            <Link href="/search"><i className="pi pi-search" aria-hidden="true" /><span>{copy.search}</span><i className="pi pi-arrow-up-right" aria-hidden="true" /></Link>
            <Link href="/chat"><i className="pi pi-comments" aria-hidden="true" /><span>{copy.chat}</span><i className="pi pi-arrow-up-right" aria-hidden="true" /></Link>
          </div>
        </article>
      </div>

      {status ? <p className="form-message dashboard-message">{status}</p> : null}
    </section>
  );
}
