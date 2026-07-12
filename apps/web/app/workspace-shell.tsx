"use client";

import Link from "next/link";
import { useState } from "react";
import { AIcon } from "../components/ui";
import { WorkspaceApp, type WorkspaceSectionId, sections } from "./workspace-app";
import { WorkspaceProvider } from "./workspace-context";
import { SettingsPanel } from "./settings-panel";
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  return (
    <WorkspaceProvider>
      <main className="platform-shell">
        <header className="platform-header">
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? (language === "tr" ? "Sidebari ac" : "Open sidebar") : language === "tr" ? "Sidebari kapat" : "Close sidebar"}
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
          <nav aria-label={language === "tr" ? "Workspace bolumleri" : "Workspace sections"}>
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
          <nav className="sidebar__bottom-nav" aria-label={language === "tr" ? "Platform ayarlari" : "Platform settings"}>
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
            {activeSection === "settings" ? <SettingsPanel /> : <WorkspaceApp activeSection={activeSection} />}
          </section>
        </div>
      </main>
    </WorkspaceProvider>
  );
}

function sectionLabel(section: WorkspaceSectionId, language: "tr" | "en") {
  const labels: Record<WorkspaceSectionId, Record<"tr" | "en", string>> = {
    dashboard: { tr: "Panel", en: "Dashboard" },
    upload: { tr: "Yukle", en: "Upload" },
    documents: { tr: "Belgeler", en: "Documents" },
    entities: { tr: "Varliklar", en: "Entities" },
    search: { tr: "Arama", en: "Search" },
    chat: { tr: "Sohbet", en: "Chat" },
    transfer: { tr: "Aktarim", en: "Transfer" }
  };

  return labels[section][language];
}
