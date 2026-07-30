"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AIcon } from "../components/ui";
import { WorkspaceApp, type WorkspaceSectionId, sections } from "./workspace-app";
import { WorkspaceProvider } from "./workspace-context";
import { SettingsPanel } from "./settings-panel";
import { WorkspaceSettingsPanel } from "./workspace-settings-panel";
import { TransferPanel } from "./transfer-panel";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { LanguageProvider, useLanguage } from "./language-context";

type ShellPageId = WorkspaceSectionId | "settings";

type WorkspaceShellProps = {
  activeSection?: ShellPageId;
};

export function WorkspaceShell({ activeSection = "dashboard" }: WorkspaceShellProps) {
  return (
    <LanguageProvider>
      <WorkspaceShellContent activeSection={activeSection} />
    </LanguageProvider>
  );
}

function WorkspaceShellContent({ activeSection }: Required<WorkspaceShellProps>) {
  const { language } = useLanguage();
  // The initial render must be identical on the server and browser. Read the
  // saved preference only after hydration to avoid a markup mismatch.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [hasLoadedSidebarPreference, setHasLoadedSidebarPreference] = useState(false);

  useEffect(() => {
    setIsSidebarCollapsed(
      window.localStorage.getItem("knowledgeos-sidebar-collapsed") !== "false"
    );
    setHasLoadedSidebarPreference(true);
  }, []);

  useEffect(() => {
    if (hasLoadedSidebarPreference) {
      window.localStorage.setItem("knowledgeos-sidebar-collapsed", String(isSidebarCollapsed));
    }
  }, [hasLoadedSidebarPreference, isSidebarCollapsed]);

  return (
    <WorkspaceProvider>
      <main className="platform-shell">
        <header className="platform-header">
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? (language === "tr" ? "Kenar çubuğunu aç" : "Open sidebar") : language === "tr" ? "Kenar çubuğunu kapat" : "Close sidebar"}
            aria-expanded={!isSidebarCollapsed}
          >
            <span
              className={isSidebarCollapsed ? "pi pi-angle-right" : "pi pi-angle-left"}
              aria-hidden="true"
            />
          </button>
          <strong className="platform-header__brand">KnowledgeOS</strong>
          <ModelDownloadStatus language={language} />
        </header>

        <div className={isSidebarCollapsed ? "app-shell is-sidebar-collapsed" : "app-shell"}>
          <aside className="sidebar">
            {!isSidebarCollapsed ? <WorkspaceSwitcher /> : null}
          <nav aria-label={language === "tr" ? "Workspace bölümleri" : "Workspace sections"}>
            {sections.map((section) => {
              const isActive = activeSection === section.id;

              return (
                <Link
                  key={section.id}
                  href={`/${section.id}`}
                  className={isActive ? "active" : ""}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={isSidebarCollapsed ? sectionLabel(section.id, language) : undefined}
                >
                  <AIcon icon={<span className={`pi ${section.icon}`} />} tooltip={sectionLabel(section.id, language)} />
                  {!isSidebarCollapsed ? <span>{sectionLabel(section.id, language)}</span> : null}
                </Link>
              );
            })}
          </nav>
          <nav className="sidebar__bottom-nav" aria-label={language === "tr" ? "Platform ayarları" : "Platform settings"}>
            <Link
              href="/architecture"
              className={activeSection === "architecture" ? "active" : ""}
              aria-current={activeSection === "architecture" ? "page" : undefined}
              aria-label={isSidebarCollapsed ? sectionLabel("architecture", language) : undefined}
            >
              <AIcon icon={<span className="pi pi-share-alt" />} tooltip={sectionLabel("architecture", language)} />
              {!isSidebarCollapsed ? <span>{sectionLabel("architecture", language)}</span> : null}
            </Link>
            <Link
              href="/settings"
              className={activeSection === "settings" ? "active" : ""}
              aria-current={activeSection === "settings" ? "page" : undefined}
              aria-label={isSidebarCollapsed ? (language === "tr" ? "Ayarlar" : "Settings") : undefined}
            >
              <AIcon icon={<span className="pi pi-cog" />} tooltip={language === "tr" ? "Ayarlar" : "Settings"} />
              {!isSidebarCollapsed ? <span>{language === "tr" ? "Ayarlar" : "Settings"}</span> : null}
            </Link>
          </nav>
          </aside>

          <section className="content">
            {activeSection === "settings" ? (
              <div className="settings-layout">
                <SettingsPanel />
                <WorkspaceSettingsPanel />
                <TransferPanel />
              </div>
            ) : <WorkspaceApp activeSection={activeSection} />}
          </section>
        </div>
      </main>
    </WorkspaceProvider>
  );
}

function ModelDownloadStatus({ language }: { language: "tr" | "en" }) {
  const [download, setDownload] = useState<{ model: string; completed: number; total: number; startedAt: number } | null>(null);
  const [speed, setSpeed] = useState(0);
  const previous = useRef<{ completed: number; at: number } | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("http://127.0.0.1:4000/api/settings/models/pull/active", { cache: "no-store" });
        if (!response.ok) return;
        const operations = await response.json() as Array<{ model: string; completed: number; total: number; startedAt: number }>;
        const current = operations[0] ?? null;
        if (!active) return;
        setDownload(current);
        if (!current) { previous.current = null; setSpeed(0); return; }
        const now = Date.now();
        if (previous.current && current.completed >= previous.current.completed) {
          const elapsed = (now - previous.current.at) / 1000;
          if (elapsed > 0) setSpeed((current.completed - previous.current.completed) / elapsed);
        }
        previous.current = { completed: current.completed, at: now };
      } catch { /* The header should not affect the rest of the shell. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!download) return null;
  const percent = download.total > 0 ? Math.min(100, Math.round(download.completed / download.total * 100)) : 0;
  const progressText = download.total > 0 ? `${formatBytes(download.completed)} / ${formatBytes(download.total)}` : (language === "tr" ? "Boyut hesaplanıyor" : "Calculating size");
  return <div className="platform-header__download" role="status" aria-live="polite" title={`${download.model} · ${progressText}`}>
    <div className="platform-header__download-heading"><i className="pi pi-download" aria-hidden="true" /><strong>{download.model}</strong><span>{percent}%</span></div>
    <progress value={percent} max="100" aria-label={language === "tr" ? "Model indirme ilerlemesi" : "Model download progress"} />
    <small>{progressText}{speed > 0 ? ` · ${formatBytes(speed)}/s` : ""}</small>
  </div>;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function sectionLabel(section: WorkspaceSectionId, language: "tr" | "en") {
  const labels: Record<WorkspaceSectionId, Record<"tr" | "en", string>> = {
    dashboard: { tr: "Panel", en: "Dashboard" },
    upload: { tr: "Yükle", en: "Upload" },
    convert: { tr: "Dosya Dönüştür", en: "File Conversion" },
    documents: { tr: "Belgeler", en: "Documents" },
    entities: { tr: "Varlıklar", en: "Entities" },
    search: { tr: "Arama", en: "Search" },
    chat: { tr: "Sohbet", en: "Chat" },
    architecture: { tr: "Sistem Haritası", en: "System Map" },
  };

  return labels[section][language];
}
