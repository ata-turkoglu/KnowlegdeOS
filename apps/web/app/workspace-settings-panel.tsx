"use client";

import { useEffect, useState } from "react";
import { AButton, ADialog, AInput } from "../components/ui";
import { useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

export function WorkspaceSettingsPanel() {
  const { language } = useLanguage();
  const { workspaceSlug, workspaces, reloadWorkspaces } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const [clearingDocuments, setClearingDocuments] = useState(false);
  const [clearDocumentsDialogVisible, setClearDocumentsDialogVisible] = useState(false);
  const [message, setMessage] = useState("");
  const workspace = workspaces.find((item) => item.slug === workspaceSlug);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
  }, [workspace?.description, workspace?.name, workspaceSlug]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces/${encodeURIComponent(workspaceSlug)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), description }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Workspace could not be updated.");
      await reloadWorkspaces();
      setMessage(language === "tr" ? "Workspace bilgileri güncellendi." : "Workspace details updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : language === "tr" ? "Workspace güncellenemedi." : "Workspace could not be updated.");
    } finally { setSaving(false); }
  }

  async function clearIndexes() {
    setClearing(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces/${encodeURIComponent(workspaceSlug)}/clear-indexes`, { method: "POST" });
      const result = await response.json() as { documentCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Indexes could not be cleared.");
      setMessage(language === "tr" ? `${result.documentCount ?? 0} belgenin indeks verileri temizlendi.` : `Index data for ${result.documentCount ?? 0} documents was cleared.`);
      setClearDialogVisible(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : language === "tr" ? "İndeksler temizlenemedi." : "Indexes could not be cleared.");
    } finally { setClearing(false); }
  }

  async function clearDocuments() {
    setClearingDocuments(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces/${encodeURIComponent(workspaceSlug)}/clear-documents`, { method: "POST" });
      const result = await response.json() as { documentCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Workspace documents could not be cleared.");
      setMessage(language === "tr" ? `${result.documentCount ?? 0} yüklenmiş belge temizlendi. Dönüştürülmüş Markdown dosyaları korundu.` : `${result.documentCount ?? 0} uploaded documents cleared. Converted Markdown files were kept.`);
      setClearDocumentsDialogVisible(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : language === "tr" ? "Yüklenmiş belgeler temizlenemedi." : "Uploaded documents could not be cleared.");
    } finally { setClearingDocuments(false); }
  }

  return <section className="workspace-settings-panel panel">
    <div>
      <h3>{language === "tr" ? "Workspace ayarları" : "Workspace settings"}</h3>
      <p>{language === "tr" ? "Seçili workspace için ayar ve bakım işlemleri." : "Settings and maintenance for the selected workspace."}</p>
    </div>
    <div className="settings-workspace">
      <section className="settings-workspace__details">
        <h4>{language === "tr" ? "Workspace bilgileri" : "Workspace details"}</h4>
        <label>{language === "tr" ? "Workspace adı" : "Workspace name"}<AInput value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
        <label>{language === "tr" ? "Açıklama" : "Description"}<AInput value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} /></label>
        <AButton type="button" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? (language === "tr" ? "Kaydediliyor..." : "Saving...") : (language === "tr" ? "Workspace'i güncelle" : "Update workspace")}</AButton>
        <p className="settings-note">{language === "tr" ? "İsim değişikliği workspace adresini ve dosya yolunu değiştirmez." : "Changing the name does not change the workspace URL or file path."}</p>
      </section>
      <section className="settings-workspace__danger">
        <h4>{language === "tr" ? "Tehlikeli alan" : "Danger zone"}</h4>
        <p>{language === "tr" ? "Chunk, entity ve embedding indekslerini siler. Kaynak belgeler ve dosyalar korunur." : "Clears chunk, entity, and embedding indexes. Source documents and files are kept."}</p>
        <AButton type="button" tone="secondary" onClick={() => setClearDialogVisible(true)} disabled={clearing}>{language === "tr" ? "İndeksleri temizle" : "Clear indexes"}</AButton>
        <AButton type="button" tone="secondary" onClick={() => setClearDocumentsDialogVisible(true)} disabled={clearingDocuments}>{language === "tr" ? "Yüklenmiş belgeleri temizle" : "Clear uploaded documents"}</AButton>
      </section>
    </div>
    {message ? <p className="form-message">{message}</p> : null}
    <ADialog
      visible={clearDialogVisible}
      onHide={() => !clearing && setClearDialogVisible(false)}
      header={language === "tr" ? "İndeksleri temizle" : "Clear indexes"}
      style={{ width: "min(480px, calc(100vw - 32px))" }}
      footer={<div className="button-row"><AButton tone="secondary" onClick={() => setClearDialogVisible(false)} disabled={clearing}>{language === "tr" ? "Vazgeç" : "Cancel"}</AButton><AButton tone="secondary" onClick={() => void clearIndexes()} disabled={clearing}>{clearing ? (language === "tr" ? "Temizleniyor..." : "Clearing...") : (language === "tr" ? "İndeksleri temizle" : "Clear indexes")}</AButton></div>}
    >
      <p>{language === "tr" ? `“${workspace?.name ?? workspaceSlug}” workspace'indeki tüm chunk, entity ve embedding indeksleri temizlenecek.` : `All chunk, entity, and embedding indexes in “${workspace?.name ?? workspaceSlug}” will be cleared.`}</p>
      <p>{language === "tr" ? "Kaynak belgeler ve dosyalar korunur; işlemin ardından belgeleri yeniden indeksleyebilirsiniz." : "Source documents and files are kept; you can reindex the documents afterwards."}</p>
    </ADialog>
    <ADialog
      visible={clearDocumentsDialogVisible}
      onHide={() => !clearingDocuments && setClearDocumentsDialogVisible(false)}
      header={language === "tr" ? "Yüklenmiş belgeleri temizle" : "Clear uploaded documents"}
      style={{ width: "min(480px, calc(100vw - 32px))" }}
      footer={<div className="button-row"><AButton tone="secondary" onClick={() => setClearDocumentsDialogVisible(false)} disabled={clearingDocuments}>{language === "tr" ? "Vazgeç" : "Cancel"}</AButton><AButton tone="secondary" onClick={() => void clearDocuments()} disabled={clearingDocuments}>{clearingDocuments ? (language === "tr" ? "Temizleniyor..." : "Clearing...") : (language === "tr" ? "Belgeleri temizle" : "Clear documents")}</AButton></div>}
    >
      <p>{language === "tr" ? `“${workspace?.name ?? workspaceSlug}” içindeki yüklenmiş Markdown belgeleri, kaynak taramalar ve tüm indeks kayıtları silinecek.` : `Uploaded Markdown documents, source scans, and all index data in “${workspace?.name ?? workspaceSlug}” will be deleted.`}</p>
      <p>{language === "tr" ? "converted-markdown klasöründeki dönüştürülmüş dosyalar korunur." : "Files in converted-markdown are kept."}</p>
    </ADialog>
  </section>;
}
