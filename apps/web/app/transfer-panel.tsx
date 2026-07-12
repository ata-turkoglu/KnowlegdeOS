"use client";

import { useState } from "react";
import { AButton, AFileInput, AInput } from "../components/ui";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type BundleResult = {
  workspaceSlug: string;
  fileName: string;
  bundlePath: string;
  manifest: {
    fileCount: number;
    totalBytes: number;
  };
};

type ImportResult = {
  imported: boolean;
  workspaceSlug: string;
  restoredFiles: number;
  storagePath: string;
};

export function TransferPanel() {
  const { workspaceSlug } = useWorkspace();
  const [targetSlug, setTargetSlug] = useState("merter-arsivi-import-test");
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [lastBundle, setLastBundle] = useState<BundleResult | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function postBundleAction(endpoint: "export-bundle" | "backups") {
    if (!workspaceSlug.trim()) {
      setMessage("Workspace slug bos olamaz.");
      return;
    }

    setIsBusy(true);
    setMessage("");
    setLastImport(null);

    const response = await fetch(
      `${apiBaseUrl}/api/workspaces/${encodeURIComponent(workspaceSlug)}/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );
    const body = await response.json();

    setIsBusy(false);

    if (!response.ok) {
      setMessage(body.error ?? "Islem basarisiz.");
      return;
    }

    setLastBundle(body);
    setMessage(endpoint === "backups" ? "Backup olusturuldu." : "Export bundle olusturuldu.");
  }

  async function importBundle() {
    if (!bundleFile) {
      setMessage("Import icin bundle dosyasi secilmedi.");
      return;
    }

    setIsBusy(true);
    setMessage("");
    setLastBundle(null);

    let bundle: unknown;

    try {
      bundle = JSON.parse(await bundleFile.text()) as unknown;
    } catch {
      setIsBusy(false);
      setMessage("Bundle dosyasi gecerli JSON degil.");
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/workspaces/import-bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        targetSlug,
        bundle
      })
    });
    const body = await response.json();

    setIsBusy(false);

    if (!response.ok) {
      setMessage(body.error ?? "Import basarisiz.");
      return;
    }

    setLastImport(body);
    setMessage("Workspace import edildi.");
  }

  return (
    <section className="panel transfer-panel">
      <div>
        <p className="eyebrow">Tasinabilirlik</p>
        <h3>Export, backup ve import</h3>
      </div>

      <div className="transfer-grid">
        <div className="button-row transfer-actions">
          <AButton
            type="button"
            onClick={() => postBundleAction("export-bundle")}
            disabled={isBusy}
          >
            Export
          </AButton>
          <AButton
            type="button"
            tone="secondary"
            onClick={() => postBundleAction("backups")}
            disabled={isBusy}
          >
            Backup
          </AButton>
        </div>
      </div>

      {lastBundle ? (
        <div className="transfer-result">
          <div className="result-strip">
            <span>Dosya</span>
            <strong>{lastBundle.fileName}</strong>
          </div>
          <div className="result-strip">
            <span>Icerik</span>
            <strong>
              {lastBundle.manifest.fileCount} dosya · {lastBundle.manifest.totalBytes} byte
            </strong>
          </div>
          <p className="path-output">{lastBundle.bundlePath}</p>
        </div>
      ) : null}

      <div className="import-box">
        <label>
          Hedef workspace slug
          <AInput value={targetSlug} onChange={(event) => setTargetSlug(event.target.value)} />
        </label>

        <label>
          Export bundle
          <AFileInput
            accept=".json,.knowledgeos-export.json,application/json"
            onChange={(event) => setBundleFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <AButton type="button" onClick={importBundle} disabled={isBusy}>
          Import
        </AButton>
      </div>

      {lastImport ? (
        <div className="transfer-result">
          <div className="result-strip">
            <span>Workspace</span>
            <strong>{lastImport.workspaceSlug}</strong>
          </div>
          <div className="result-strip">
            <span>Restore</span>
            <strong>{lastImport.restoredFiles} dosya</strong>
          </div>
          <p className="path-output">{lastImport.storagePath}</p>
        </div>
      ) : null}

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
