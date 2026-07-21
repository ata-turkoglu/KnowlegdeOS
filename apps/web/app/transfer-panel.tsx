"use client";

import { useState } from "react";
import { AButton, AFileInput, AInput } from "../components/ui";
import { useLanguage } from "./language-context";
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
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [targetSlug, setTargetSlug] = useState("merter-arsivi-import-test");
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [lastBundle, setLastBundle] = useState<BundleResult | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function postBundleAction(endpoint: "export-bundle" | "backups") {
    if (!workspaceSlug.trim()) {
      setMessage(isEnglish ? "Workspace slug cannot be empty." : "Workspace slug boş olamaz.");
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
      setMessage(body.error ?? (isEnglish ? "Action failed." : "İşlem başarısız."));
      return;
    }

    setLastBundle(body);
    setMessage(endpoint === "backups" ? (isEnglish ? "Backup created." : "Yedek oluşturuldu.") : isEnglish ? "Export bundle created." : "Dışa aktarma paketi oluşturuldu.");
  }

  async function importBundle() {
    if (!bundleFile) {
      setMessage(isEnglish ? "Choose a bundle file to import." : "İçe aktarmak için paket dosyası seçilmedi.");
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
      setMessage(isEnglish ? "The bundle file is not valid JSON." : "Paket dosyası geçerli JSON değil.");
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
      setMessage(body.error ?? (isEnglish ? "Import failed." : "İçe aktarma başarısız."));
      return;
    }

    setLastImport(body);
    setMessage(isEnglish ? "Workspace imported." : "Workspace içe aktarıldı.");
  }

  return (
    <section className="panel transfer-panel">
      <div>
        <h3>{isEnglish ? "Data transfer" : "Veri aktarımı"}</h3>
        <p>
          {isEnglish
            ? "Export, back up, or import workspace data from here."
            : "Workspace verilerini buradan dışa aktarın, yedekleyin veya içe aktarın."}
        </p>
      </div>

      <div className="transfer-grid">
        <div className="button-row transfer-actions">
          <AButton
            type="button"
            onClick={() => postBundleAction("export-bundle")}
            disabled={isBusy}
          >
            {isEnglish ? "Export" : "Dışarı aktar"}
          </AButton>
          <AButton
            type="button"
            tone="secondary"
            onClick={() => postBundleAction("backups")}
            disabled={isBusy}
          >
            {isEnglish ? "Backup" : "Yedekle"}
          </AButton>
        </div>
      </div>

      {lastBundle ? (
        <div className="transfer-result">
          <div className="result-strip">
            <span>{isEnglish ? "File" : "Dosya"}</span>
            <strong>{lastBundle.fileName}</strong>
          </div>
          <div className="result-strip">
            <span>{isEnglish ? "Contents" : "İçerik"}</span>
            <strong>
              {lastBundle.manifest.fileCount} {isEnglish ? "files" : "dosya"} · {lastBundle.manifest.totalBytes} byte
            </strong>
          </div>
          <p className="path-output">{lastBundle.bundlePath}</p>
        </div>
      ) : null}

      <div className="import-box">
        <label>
          {isEnglish ? "Target workspace slug" : "Hedef workspace slug"}
          <AInput value={targetSlug} onChange={(event) => setTargetSlug(event.target.value)} />
        </label>

        <label>
          {isEnglish ? "Export bundle" : "Dışarı aktarma paketi"}
          <AFileInput
            accept=".json,.knowledgeos-export.json,application/json"
            chooseLabel={isEnglish ? "Choose file" : "Dosya seç"}
            emptyLabel={isEnglish ? "No file selected" : "Dosya seçilmedi"}
            onChange={(event) => setBundleFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <AButton type="button" onClick={importBundle} disabled={isBusy}>
          {isEnglish ? "Import" : "İçe aktar"}
        </AButton>
      </div>

      {lastImport ? (
        <div className="transfer-result">
          <div className="result-strip">
            <span>Workspace</span>
            <strong>{lastImport.workspaceSlug}</strong>
          </div>
          <div className="result-strip">
            <span>{isEnglish ? "Restore" : "Geri yükleme"}</span>
            <strong>{lastImport.restoredFiles} {isEnglish ? "files" : "dosya"}</strong>
          </div>
          <p className="path-output">{lastImport.storagePath}</p>
        </div>
      ) : null}

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
