"use client";

import Link from "next/link";
import { useState } from "react";
import { AIcon } from "../components/ui";
import { WorkspaceApp, type WorkspaceSectionId, sections } from "./workspace-app";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

const sectionMeta: Record<WorkspaceSectionId, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Sprint 23", title: "Genel durum ve sistem ozeti" },
  documents: { eyebrow: "Sprint 23", title: "Belgeler ve indeksleme durumu" },
  entities: { eyebrow: "Sprint 23", title: "Varliklar, aliaslar ve birlestirme" },
  search: { eyebrow: "Sprint 23", title: "Hibrit arama ve kaynak inceleme" },
  chat: { eyebrow: "Sprint 23", title: "Sohbet ve kaynakli cevaplar" },
  transfer: { eyebrow: "Sprint 23", title: "Yedek alma ve tasima" },
  upload: { eyebrow: "Sprint 23", title: "Upload ve indeksleme akis" }
};

type WorkspaceShellProps = {
  activeSection?: WorkspaceSectionId;
};

export function WorkspaceShell({ activeSection = "dashboard" }: WorkspaceShellProps) {
  const meta = sectionMeta[activeSection];
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <WorkspaceProvider>
      <main className="platform-shell">
        <header className="platform-header">
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? "Sidebari ac" : "Sidebari kapat"}
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
          <nav aria-label="Workspace sections">
            {sections.map((section) => {
              const isActive = activeSection === section.id;

              return (
                <Link
                  key={section.id}
                  href={`/${section.id}`}
                  className={isActive ? "active" : ""}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={isSidebarCollapsed ? section.label : undefined}
                >
                  <AIcon icon={<span className={`pi ${section.icon}`} />} tooltip={section.label} />
                  {!isSidebarCollapsed ? <span>{section.label}</span> : null}
                </Link>
              );
            })}
          </nav>
          </aside>

          <section className="content">
            <header className="topbar">
              <div>
                <p className="eyebrow">{meta.eyebrow}</p>
                <h2>{meta.title}</h2>
              </div>
              <span className="status">localhost</span>
            </header>

            <WorkspaceApp activeSection={activeSection} />
          </section>
        </div>
      </main>
    </WorkspaceProvider>
  );
}
