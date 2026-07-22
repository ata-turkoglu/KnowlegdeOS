"use client";

import { useEffect, useState } from "react";
import { AButton, ADialog } from "../components/ui";
import { useLanguage } from "./language-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type Operation = {
  id: string;
  kind: "upload" | "index" | "reindex" | "embedding";
  targetName: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  stage: string;
  progress: number;
  error?: string;
  retry?: { documentName?: string; useLlm?: boolean };
};

type Gpu = {
  available: boolean;
  reason?: string;
  name?: string;
  utilization?: number;
  memoryUsed?: number;
  memoryTotal?: number;
  temperature?: number;
  powerDraw?: number;
};

export function OperationStatusButton({ workspaceSlug }: { workspaceSlug: string }) {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [hasSelectedOllamaEmbedding, setHasSelectedOllamaEmbedding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/settings/models`)
      .then(async (response) => response.ok ? response.json() as Promise<{ embeddingProvider: string; embeddingModel: string; models: string[] }> : null)
      .then((settings) => {
        if (!cancelled && settings) setHasSelectedOllamaEmbedding(settings.embeddingProvider === "ollama" && settings.models.includes(settings.embeddingModel));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!hasSelectedOllamaEmbedding) return null;

  return <>
    <AButton type="button" tone="secondary" onClick={() => setVisible(true)}>
      <i className="pi pi-chart-bar" aria-hidden="true" />
      {language === "en" ? "Operation status" : "İşlem durumu"}
    </AButton>
    <OperationStatusDialog visible={visible} onHide={() => setVisible(false)} workspaceSlug={workspaceSlug} />
  </>;
}

function OperationStatusDialog({ visible, onHide, workspaceSlug }: { visible: boolean; onHide: () => void; workspaceSlug: string }) {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const [operations, setOperations] = useState<Operation[]>([]);
  const [gpu, setGpu] = useState<Gpu | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [operationsResponse, gpuResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/api/operations?workspaceSlug=${encodeURIComponent(workspaceSlug)}`),
          fetch(`${apiBaseUrl}/api/gpu`)
        ]);
        if (!cancelled && operationsResponse.ok) setOperations(await operationsResponse.json());
        if (!cancelled && gpuResponse.ok) {
          const nextGpu = await gpuResponse.json() as Gpu;
          if (nextGpu.available || !gpu?.available) setGpu(nextGpu);
        }
      } catch {
        // Preserve the last successful status while the next poll is retried.
      }
    }
    if (visible) {
      void refresh();
      const timer = window.setInterval(() => void refresh(), 2500);
      return () => { cancelled = true; window.clearInterval(timer); };
    }
  }, [visible, workspaceSlug, gpu?.available]);

  const label = (status: Operation["status"]) => ({
    running: isEnglish ? "Running" : "Devam ediyor",
    completed: isEnglish ? "Completed" : "Tamamlandı",
    failed: isEnglish ? "Failed" : "Hata",
    cancelled: isEnglish ? "Cancelled" : "İptal edildi",
    interrupted: isEnglish ? "Interrupted" : "Kesildi"
  }[status]);

  async function retry(item: Operation) {
    if (!item.retry?.documentName) return;
    await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(item.retry.documentName)}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useLlm: item.retry.useLlm === true })
    });
  }

  async function cancel(item: Operation) {
    if (item.kind !== "embedding") return;
    await fetch(`${apiBaseUrl}/api/operations/${encodeURIComponent(item.id)}`, { method: "DELETE" });
  }

  async function clearHistory() {
    setIsClearingHistory(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/operations?workspaceSlug=${encodeURIComponent(workspaceSlug)}`, { method: "DELETE" });
      if (response.ok) setOperations((current) => current.filter((item) => item.status === "running"));
    } finally {
      setIsClearingHistory(false);
    }
  }

  const row = (item: Operation) => <article className={`operation-row is-${item.status}`} key={item.id}>
    <div>
      <strong>{item.targetName}</strong>
      <span>{item.stage}</span>
      {item.error ? <small>{item.error}</small> : null}
    </div>
    <div className="operation-row__status">
      <b>{label(item.status)}</b>
      <progress value={item.progress} max="100" />
      <span>{item.progress}%</span>
      {item.status === "running" && item.kind === "embedding" ? <AButton type="button" tone="secondary" onClick={() => void cancel(item)}>{isEnglish ? "Stop" : "Durdur"}</AButton> : null}
      {item.status !== "running" && item.retry?.documentName ? <AButton type="button" tone="secondary" onClick={() => void retry(item)}>{isEnglish ? "Retry" : "Tekrar dene"}</AButton> : null}
    </div>
  </article>;

  const active = operations.filter((item) => item.status === "running");
  const history = operations.filter((item) => item.status !== "running");

  return <ADialog visible={visible} onHide={onHide} header={isEnglish ? "Operation status" : "İşlem durumu"} style={{ width: "min(760px, calc(100vw - 32px))" }}>
    <section className="gpu-gauge">
      <h3>{isEnglish ? "GPU telemetry" : "GPU telemetrisi"}</h3>
      {gpu?.available ? <div className="gpu-gauge__content">
        <div className="gpu-gauge__ring" style={{ "--gauge": `${gpu.utilization ?? 0}%` } as React.CSSProperties}><strong>{gpu.utilization}%</strong><span>GPU</span></div>
        <div><strong>{gpu.name}</strong><span>{gpu.memoryUsed} / {gpu.memoryTotal} MiB VRAM</span><span>{gpu.temperature}°C · {gpu.powerDraw} W</span></div>
      </div> : <p>{gpu?.reason ?? (isEnglish ? "Loading GPU telemetry…" : "GPU telemetrisi yükleniyor…")}</p>}
    </section>
    <section className="operation-list">
      <h3>{isEnglish ? "Active operations" : "Aktif işlemler"}</h3>
      {active.length ? active.map(row) : <p>{isEnglish ? "No active operations." : "Aktif işlem yok."}</p>}
      <div className="operation-history-heading">
        <h3>{isEnglish ? "Recent history" : "Son işlemler"}</h3>
        {history.length ? <AButton type="button" tone="secondary" onClick={() => void clearHistory()} disabled={isClearingHistory}>{isClearingHistory ? (isEnglish ? "Clearing…" : "Temizleniyor…") : (isEnglish ? "Clear history" : "Geçmişi temizle")}</AButton> : null}
      </div>
      {history.length ? history.map(row) : <p>{isEnglish ? "No recent operations." : "Yakın tarihli işlem yok."}</p>}
    </section>
  </ADialog>;
}
