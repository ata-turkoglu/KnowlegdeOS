import { ChatPanel } from "./chat-panel";
import { ConversionPanel } from "./conversion-panel";
import { DashboardMetrics } from "./dashboard-metrics";
import { DocumentsPanel } from "./documents-panel";
import { EntitiesPanel } from "./entities-panel";
import { SearchPanel } from "./search-panel";
import { UploadPanel } from "./upload-panel";
import { ArchitectureMap } from "./architecture-map";

export const sections = [
  { id: "dashboard", label: "Dashboard", icon: "pi-home" },
  { id: "convert", label: "Convert", icon: "pi-file-edit" },
  { id: "upload", label: "Upload", icon: "pi-upload" },
  { id: "documents", label: "Documents", icon: "pi-file" },
  { id: "entities", label: "Entities", icon: "pi-sitemap" },
  { id: "search", label: "Search", icon: "pi-search" },
  { id: "chat", label: "Chat", icon: "pi-comments" }
] as const;

export type WorkspaceSectionId = (typeof sections)[number]["id"] | "architecture";

type WorkspaceAppProps = {
  activeSection: WorkspaceSectionId;
};

export function WorkspaceApp({ activeSection }: WorkspaceAppProps) {
  return (
    <section className="workspace-content" aria-live="polite">
      {activeSection === "dashboard" ? <DashboardMetrics /> : null}
      {activeSection === "documents" ? <DocumentsPanel /> : null}
      {activeSection === "entities" ? <EntitiesPanel /> : null}
      {activeSection === "search" ? <SearchPanel /> : null}
      {activeSection === "chat" ? <ChatPanel /> : null}
      {activeSection === "upload" ? <UploadPanel /> : null}
      {activeSection === "convert" ? <ConversionPanel /> : null}
      {activeSection === "architecture" ? <ArchitectureMap /> : null}
    </section>
  );
}
