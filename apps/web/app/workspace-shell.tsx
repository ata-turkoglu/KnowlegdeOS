"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AIcon } from "../components/ui";
import { WorkspaceApp, type WorkspaceSectionId, sections } from "./workspace-app";
import { WorkspaceProvider } from "./workspace-context";
import { SettingsPanel } from "./settings-panel";
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
                <TransferPanel />
              </div>
            ) : <WorkspaceApp activeSection={activeSection} />}
          </section>
        </div>
      </main>
    </WorkspaceProvider>
  );
}

function sectionLabel(section: WorkspaceSectionId, language: "tr" | "en") {
  const labels: Record<WorkspaceSectionId, Record<"tr" | "en", string>> = {
    dashboard: { tr: "Panel", en: "Dashboard" },
    upload: { tr: "Yükle", en: "Upload" },
    documents: { tr: "Belgeler", en: "Documents" },
    entities: { tr: "Varlıklar", en: "Entities" },
    search: { tr: "Arama", en: "Search" },
    chat: { tr: "Sohbet", en: "Chat" },
  };

  return labels[section][language];
}
