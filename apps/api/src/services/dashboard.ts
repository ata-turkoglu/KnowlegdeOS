import { and, count, eq, isNotNull } from "drizzle-orm";
import { createDatabaseClient, documentChunks, documents, entities, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";

export type DashboardSummary = { workspaceSlug: string; workspaceCount: number; documentCount: number; indexedDocumentCount: number; entityCount: number; chunkCount: number; embeddingCount: number };
export async function getDashboardSummary(config: ApiConfig, workspaceSlugInput: string): Promise<DashboardSummary> {
  const client = createDatabaseClient(config.databaseUrl); const slug = slugify(workspaceSlugInput || "merter-arsivi");
  try {
    const [workspace] = await client.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return { workspaceSlug: slug, workspaceCount: 0, documentCount: 0, indexedDocumentCount: 0, entityCount: 0, chunkCount: 0, embeddingCount: 0 };
    const [[workspaceCount], [documentCount], [indexedDocumentCount], [entityCount], [chunkCount], [embeddingCount]] = await Promise.all([
      client.db.select({ value: count() }).from(workspaces), client.db.select({ value: count() }).from(documents).where(eq(documents.workspaceId, workspace.id)), client.db.select({ value: count() }).from(documents).where(and(eq(documents.workspaceId, workspace.id), eq(documents.status, "INDEXED"))), client.db.select({ value: count() }).from(entities).where(eq(entities.workspaceId, workspace.id)), client.db.select({ value: count() }).from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.documentId)).where(eq(documents.workspaceId, workspace.id)), client.db.select({ value: count() }).from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.documentId)).where(and(eq(documents.workspaceId, workspace.id), isNotNull(documentChunks.embedding)))
    ]);
    return { workspaceSlug: slug, workspaceCount: Number(workspaceCount.value), documentCount: Number(documentCount.value), indexedDocumentCount: Number(indexedDocumentCount.value), entityCount: Number(entityCount.value), chunkCount: Number(chunkCount.value), embeddingCount: Number(embeddingCount.value) };
  } finally { await client.close(); }
}
