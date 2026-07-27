import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { createDatabaseClient, documentChunks, documents, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { getEmbeddingProvider, selectedEmbeddingModel } from "./ai-providers.js";
import { getWorkspaceIngestionSettings } from "./workspace-settings.js";

export type SemanticSearchResult = { queryType: "SEMANTIC_SEARCH"; query: string; embeddingModel: string; results: Array<{ documentName: string; title: string; chunkIndex: number; heading: string | null; score: number; snippet: string }>; sources: Array<{ documentName: string; title: string; evidenceSnippet: string; score: number }> };
export type SemanticContextChunk = { documentName: string; title: string; chunkIndex: number; heading: string | null; content: string };
export type EmbeddingCoverageItem = { documentName: string; title: string; chunkCount: number; embeddedChunkCount: number; status: "MISSING" | "READY" };

async function withDb<T>(config: ApiConfig, fn: (client: ReturnType<typeof createDatabaseClient>) => Promise<T>) {
  const client = createDatabaseClient(config.databaseUrl); try { return await fn(client); } finally { await client.close(); }
}
async function workspaceId(db: ReturnType<typeof createDatabaseClient>["db"], slug: string) {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!workspace) throw new Error(`Workspace '${slug}' was not found.`);
  return workspace.id;
}
const documentName = (filename: string) => slugify(filename.replace(/\.[^.]+$/, ""));
const vectorLiteral = (values: number[]) => `[${values.join(",")}]`;
const embeddingDimensions = 1024;

function assertEmbeddingDimensions(embedding: number[]) {
  if (embedding.length !== embeddingDimensions) {
    throw new Error(`The selected embedding model returned ${embedding.length} dimensions; this installation requires ${embeddingDimensions}. Choose a compatible model or configure it to return ${embeddingDimensions} dimensions.`);
  }
}

export async function getEmbeddingCoverage(config: ApiConfig, workspaceSlugInput: string): Promise<EmbeddingCoverageItem[]> {
  const slug = slugify(workspaceSlugInput);
  const model = selectedEmbeddingModel(config);
  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slug);
    const rows = await db.select({ filename: documents.filename, title: documents.title, chunkCount: count(documentChunks.id), embedded: sql<number>`count(${documentChunks.id}) filter (where ${documentChunks.embedding} is not null)` })
      .from(documents).leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
      .where(and(eq(documents.workspaceId, id), eq(documents.status, "INDEXED"), eq(documents.embeddingModel, model)))
      .groupBy(documents.id).orderBy(documents.filename);
    return rows.map((row) => ({ documentName: documentName(row.filename), title: row.title, chunkCount: Number(row.chunkCount), embeddedChunkCount: Number(row.embedded), status: Number(row.chunkCount) > 0 && Number(row.chunkCount) === Number(row.embedded) ? "READY" : "MISSING" }));
  });
}

export async function embedSelectedDocuments(config: ApiConfig, workspaceSlugInput: string, names: string[], onProgress?: (value: { completed: number; total: number; documentName: string }) => void, signal?: AbortSignal) {
  const slug = slugify(workspaceSlugInput); const model = selectedEmbeddingModel(config); const provider = getEmbeddingProvider(config);
  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slug);
    // Uploads may be either .md or .txt, so compare normalized stems after the workspace filter.
    const all = await db.select({ id: documents.id, filename: documents.filename }).from(documents).where(eq(documents.workspaceId, id));
    const selected = all.filter((row) => names.map(slugify).includes(documentName(row.filename)));
    let completed = 0;
    for (const document of selected) {
      if (signal?.aborted) throw new Error("Embedding cancelled.");
      onProgress?.({ completed, total: selected.length, documentName: documentName(document.filename) });
      const chunks = await db.select().from(documentChunks).where(eq(documentChunks.documentId, document.id)).orderBy(documentChunks.chunkIndex);
      for (const chunk of chunks) {
        if (signal?.aborted) throw new Error("Embedding cancelled.");
        const embedding = await provider.embed(chunk.content);
        assertEmbeddingDimensions(embedding);
        await db.update(documentChunks).set({ embedding }).where(eq(documentChunks.id, chunk.id));
      }
      await db.update(documents).set({ embeddingModel: model, updatedAt: new Date() }).where(eq(documents.id, document.id));
      completed += 1; onProgress?.({ completed, total: selected.length, documentName: documentName(document.filename) });
    }
    return { workspaceSlug: slug, embeddedDocumentCount: completed };
  });
}

/** Compatibility name: vectors are persisted immediately, so no filesystem index exists to rebuild. */
export async function rebuildSemanticIndex(config: ApiConfig, workspaceSlug: string) {
  const coverage = await getEmbeddingCoverage(config, workspaceSlug); return { workspaceSlug: slugify(workspaceSlug), chunks: coverage.reduce((sum, item) => sum + item.embeddedChunkCount, 0) };
}
export async function invalidateSemanticIndex(_config: ApiConfig, _workspaceSlug: string) { /* DB rows are invalidated by reindex replacement. */ }

export async function searchSemanticDocuments(config: ApiConfig, input: { workspaceSlug: string; query: string; limit?: number }): Promise<SemanticSearchResult> {
  const slug = slugify(input.workspaceSlug); const model = selectedEmbeddingModel(config); const settings = await getWorkspaceIngestionSettings(config, slug); const query = await getEmbeddingProvider(config).embed(input.query);
  assertEmbeddingDimensions(query);
  return withDb(config, async ({ db, queryClient }) => {
    const id = await workspaceId(db, slug); const limit = input.limit ?? settings.semanticTopK;
    // postgres.js parameterizes the vector literal; <=> is cosine distance, so score is 1-distance.
    const rows = await queryClient<{ filename: string; title: string; chunk_index: number; heading: string | null; content: string; score: number }[]>`
      select d.filename, d.title, c.chunk_index, c.heading, c.content, (1 - (c.embedding <=> ${vectorLiteral(query)}::vector))::float8 as score
      from document_chunks c join documents d on d.id = c.document_id
      where d.workspace_id = ${id} and d.status = 'INDEXED' and d.embedding_model = ${model} and c.embedding is not null
      order by c.embedding <=> ${vectorLiteral(query)}::vector limit ${limit}`;
    const results = rows.filter((row) => Number(row.score) >= settings.similarityThreshold).map((row) => ({ documentName: documentName(row.filename), title: row.title, chunkIndex: row.chunk_index, heading: row.heading, score: Number(row.score), snippet: row.content.slice(0, 500) }));
    return { queryType: "SEMANTIC_SEARCH", query: input.query, embeddingModel: model, results, sources: results.map((result) => ({ documentName: result.documentName, title: result.title, evidenceSnippet: result.snippet, score: result.score })) };
  });
}

export async function getSemanticContext(config: ApiConfig, workspaceSlug: string, results: SemanticSearchResult["results"]): Promise<SemanticContextChunk[]> {
  const wanted = new Set(results.map((result) => `${result.documentName}:${result.chunkIndex}`));
  return withDb(config, async ({ db }) => { const id = await workspaceId(db, slugify(workspaceSlug)); const rows = await db.select({ filename: documents.filename, title: documents.title, chunkIndex: documentChunks.chunkIndex, heading: documentChunks.heading, content: documentChunks.content }).from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.documentId)).where(eq(documents.workspaceId, id)); return rows.filter((row) => wanted.has(`${documentName(row.filename)}:${row.chunkIndex}`)).map((row) => ({ documentName: documentName(row.filename), title: row.title, chunkIndex: row.chunkIndex, heading: row.heading, content: row.content })); });
}

export async function getLexicalSemanticContext(config: ApiConfig, workspaceSlug: string, query: string, limit = 4): Promise<SemanticContextChunk[]> {
  const terms = [...new Set(query.toLocaleLowerCase("tr-TR").match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  if (!terms.length) return [];
  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slugify(workspaceSlug));
    const rows = await db.select({ filename: documents.filename, title: documents.title, chunkIndex: documentChunks.chunkIndex, heading: documentChunks.heading, content: documentChunks.content }).from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.documentId)).where(eq(documents.workspaceId, id));
    return rows.map((row) => ({ ...row, score: terms.reduce((score, term) => score + (row.content.toLocaleLowerCase("tr-TR").includes(term) ? 1 : 0), 0) })).filter((row) => row.score > 0).sort((left, right) => right.score - left.score).slice(0, limit).map((row) => ({ documentName: documentName(row.filename), title: row.title, chunkIndex: row.chunkIndex, heading: row.heading, content: row.content }));
  });
}
