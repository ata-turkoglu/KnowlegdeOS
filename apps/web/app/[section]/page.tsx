import { notFound } from "next/navigation";
import { WorkspaceShell } from "../workspace-shell";
import { sections, type WorkspaceSectionId } from "../workspace-app";

type SectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

function isWorkspaceSectionId(section: string): section is WorkspaceSectionId {
  return sections.some((item) => item.id === section);
}

export function generateStaticParams() {
  return sections.map((section) => ({
    section: section.id
  }));
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;

  if (!isWorkspaceSectionId(section)) {
    notFound();
  }

  return <WorkspaceShell activeSection={section} />;
}
