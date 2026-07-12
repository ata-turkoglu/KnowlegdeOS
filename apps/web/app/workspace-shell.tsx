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

const sectionMeta: Record<ShellPageId, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Sprint 23", title: "Genel durum ve sistem ozeti" },
  documents: { eyebrow: "Sprint 23", title: "Belgeler ve indeksleme durumu" },
  entities: { eyebrow: "Sprint 23", title: "Varliklar, aliaslar ve birlestirme" },
  search: { eyebrow: "Sprint 23", title: "Hibrit arama ve kaynak inceleme" },
  chat: { eyebrow: "Sprint 23", title: "Sohbet ve kaynakli cevaplar" },
  transfer: { eyebrow: "Sprint 23", title: "Yedek alma ve tasima" },
  upload: { eyebrow: "Sprint 23", title: "Yükleme ve indeksleme akışı" },
  settings: { eyebrow: "Platform", title: "Ayarlar" }
};

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
  const meta = sectionMeta[activeSection];
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
            <header className="topbar">
              <div>
                <p className="eyebrow">{meta.eyebrow}</p>
                <h2>{pageTitle(activeSection, language, meta.title)}</h2>
              </div>
              <span className="status">localhost</span>
            </header>

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

function pageTitle(page: ShellPageId, language: "tr" | "en", fallback: string) {
  const titles: Partial<Record<ShellPageId, Record<"tr" | "en", string>>> = {
    dashboard: { tr: "Genel durum ve sistem ozeti", en: "System overview and status" },
    documents: { tr: "Belgeler ve indeksleme durumu", en: "Documents and indexing status" },
    entities: { tr: "Varliklar, takma adlar ve birlestirme", en: "Entities, aliases, and merging" },
    search: { tr: "Hibrit arama ve kaynak inceleme", en: "Hybrid search and source review" },
    chat: { tr: "Sohbet ve kaynakli yanitlar", en: "Chat and cited answers" },
    transfer: { tr: "Yedekleme ve tasima", en: "Backup and transfer" },
    upload: { tr: "Yukleme ve indeksleme akisi", en: "Upload and indexing flow" },
    settings: { tr: "Ayarlar", en: "Settings" }
  };

  return titles[page]?.[language] ?? fallback;
}
