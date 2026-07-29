import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { createDatabaseClient, documentChunks, documents, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { getEmbeddingProvider, selectedEmbeddingModel } from "./ai-providers.js";
import { getWorkspaceIngestionSettings } from "./workspace-settings.js";
import { extractLabeledNumericAnchors, type MetadataFilters } from "./rag-core.js";
import { ragRetrievalCache } from "./rag-cache.js";

export type SemanticSearchResult = { queryType: "SEMANTIC_SEARCH"; query: string; embeddingModel: string; results: Array<{ documentId: string; chunkId: string; documentName: string; title: string; chunkIndex: number; heading: string | null; score: number; snippet: string }>; sources: Array<{ documentName: string; title: string; evidenceSnippet: string; score: number }> };
export type SemanticContextChunk = { documentId: string; chunkId: string; documentName: string; title: string; chunkIndex: number; heading: string | null; content: string; sourceType?: "ENTITY" | "SEMANTIC" | "LEXICAL"; score?: number; retrievers?: string[] };
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
    const rows = await db.select({ filename: documents.filename, title: documents.title, embeddingModel: documents.embeddingModel, chunkCount: count(documentChunks.id), embedded: sql<number>`count(${documentChunks.id}) filter (where ${documentChunks.embedding} is not null)` })
      .from(documents).leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
      .where(and(eq(documents.workspaceId, id), eq(documents.status, "INDEXED")))
      .groupBy(documents.id).orderBy(documents.filename);
    return rows.map((row) => ({ documentName: documentName(row.filename), title: row.title, chunkCount: Number(row.chunkCount), embeddedChunkCount: Number(row.embedded), status: row.embeddingModel === model && Number(row.chunkCount) > 0 && Number(row.chunkCount) === Number(row.embedded) ? "READY" : "MISSING" }));
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
    let reusedChunkCount = 0;
    let generatedChunkCount = 0;
    for (const document of selected) {
      if (signal?.aborted) throw new Error("Embedding cancelled.");
      onProgress?.({ completed, total: selected.length, documentName: documentName(document.filename) });
      const chunks = await db.select().from(documentChunks).where(eq(documentChunks.documentId, document.id)).orderBy(documentChunks.chunkIndex);
      for (const chunk of chunks) {
        if (signal?.aborted) throw new Error("Embedding cancelled.");
        if (chunk.embedding && chunk.embeddingModel === model) {
          reusedChunkCount += 1;
          continue;
        }
        const [reusable] = await db.select({ embedding: documentChunks.embedding })
          .from(documentChunks)
          .where(and(
            eq(documentChunks.contentHash, chunk.contentHash),
            eq(documentChunks.embeddingModel, model),
            isNotNull(documentChunks.embedding)
          ))
          .limit(1);
        if (reusable?.embedding) {
          await db.update(documentChunks).set({ embedding: reusable.embedding, embeddingModel: model }).where(eq(documentChunks.id, chunk.id));
          reusedChunkCount += 1;
          continue;
        }
        const embedding = await provider.embed(chunk.content);
        assertEmbeddingDimensions(embedding);
        await db.update(documentChunks).set({ embedding, embeddingModel: model }).where(eq(documentChunks.id, chunk.id));
        generatedChunkCount += 1;
      }
      await db.update(documents).set({ embeddingModel: model, updatedAt: new Date() }).where(eq(documents.id, document.id));
      completed += 1; onProgress?.({ completed, total: selected.length, documentName: documentName(document.filename) });
    }
    ragRetrievalCache.invalidateWorkspace(slug);
    return { workspaceSlug: slug, embeddedDocumentCount: completed, reusedChunkCount, generatedChunkCount };
  });
}

/** Compatibility name: vectors are persisted immediately, so no filesystem index exists to rebuild. */
export async function rebuildSemanticIndex(config: ApiConfig, workspaceSlug: string) {
  const coverage = await getEmbeddingCoverage(config, workspaceSlug); return { workspaceSlug: slugify(workspaceSlug), chunks: coverage.reduce((sum, item) => sum + item.embeddedChunkCount, 0) };
}
export async function invalidateSemanticIndex(_config: ApiConfig, _workspaceSlug: string) { /* DB rows are invalidated by reindex replacement. */ }

export async function searchSemanticDocuments(config: ApiConfig, input: { workspaceSlug: string; query: string; limit?: number; filters?: MetadataFilters }): Promise<SemanticSearchResult> {
  const slug = slugify(input.workspaceSlug); const model = selectedEmbeddingModel(config); const settings = await getWorkspaceIngestionSettings(config, slug); const query = await getEmbeddingProvider(config).embed(input.query);
  assertEmbeddingDimensions(query);
  return withDb(config, async ({ db, queryClient }) => {
    const id = await workspaceId(db, slug); const limit = input.limit ?? settings.semanticTopK;
    const allowedIds = input.filters?.allowedDocumentIds?.length ? input.filters.allowedDocumentIds : null;
    // postgres.js parameterizes the vector literal; <=> is cosine distance, so score is 1-distance.
    const rows = await queryClient<{ document_id: string; chunk_id: string; filename: string; title: string; chunk_index: number; heading: string | null; content: string; score: number }[]>`
      select d.id as document_id, c.id as chunk_id, d.filename, d.title, c.chunk_index, c.heading, c.content, (1 - (c.embedding <=> ${vectorLiteral(query)}::vector))::float8 as score
      from document_chunks c join documents d on d.id = c.document_id
      where d.workspace_id = ${id} and d.status = 'INDEXED' and d.embedding_model = ${model} and c.embedding is not null
        and (${allowedIds}::uuid[] is null or d.id = any(${allowedIds}::uuid[]))
        and (${input.filters?.year ?? null}::text is null or extract(year from d.document_date)::text = ${input.filters?.year ?? null})
        and (${input.filters?.date ?? null}::date is null or d.document_date = ${input.filters?.date ?? null}::date)
        and (${input.filters?.documentType ?? null}::text is null or d.document_type ilike ${input.filters?.documentType ? `%${input.filters.documentType}%` : null})
      order by c.embedding <=> ${vectorLiteral(query)}::vector limit ${limit}`;
    const results = rows.filter((row) => Number(row.score) >= settings.similarityThreshold).map((row) => ({ documentId: row.document_id, chunkId: row.chunk_id, documentName: documentName(row.filename), title: row.title, chunkIndex: row.chunk_index, heading: row.heading, score: Number(row.score), snippet: row.content.slice(0, 500) }));
    return { queryType: "SEMANTIC_SEARCH", query: input.query, embeddingModel: model, results, sources: results.map((result) => ({ documentName: result.documentName, title: result.title, evidenceSnippet: result.snippet, score: result.score })) };
  });
}

export async function getSemanticContext(config: ApiConfig, workspaceSlug: string, results: SemanticSearchResult["results"]): Promise<SemanticContextChunk[]> {
  if (!results.length) return [];
  const scores = new Map(results.map((result) => [result.chunkId, result.score]));
  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slugify(workspaceSlug));
    const rows = await db.select({ documentId: documents.id, chunkId: documentChunks.id, filename: documents.filename, title: documents.title, chunkIndex: documentChunks.chunkIndex, heading: documentChunks.heading, content: documentChunks.content })
      .from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(and(eq(documents.workspaceId, id), inArray(documentChunks.id, results.map((result) => result.chunkId))));
    const byChunkId = new Map(rows.map((row) => [row.chunkId, row]));
    // SQL IN sorgusu sıralama garantisi vermez; vektör aramasının benzerlik sırası korunur.
    return results.flatMap((result) => {
      const row = byChunkId.get(result.chunkId);
      return row ? [{ ...row, documentName: documentName(row.filename), sourceType: "SEMANTIC" as const, score: scores.get(row.chunkId) ?? 0 }] : [];
    });
  });
}

export async function getLexicalSemanticContext(config: ApiConfig, workspaceSlug: string, query: string, limit = 4, filters?: MetadataFilters): Promise<SemanticContextChunk[]> {
  const terms = [...new Set(query.toLocaleLowerCase("tr-TR").match(/[\p{L}\p{N}]{3,}/gu) ?? [])]; if (!terms.length) return [];
  return withDb(config, async ({ db, queryClient }) => {
    const id = await workspaceId(db, slugify(workspaceSlug)); const phrase = terms.join(" ");
    const allowedIds = filters?.allowedDocumentIds?.length ? filters.allowedDocumentIds : null;
    type LexicalRow = { document_id: string; chunk_id: string; filename: string; title: string; chunk_index: number; heading: string | null; content: string; score: number };
    const rows = await queryClient<LexicalRow[]>`
      select d.id as document_id, c.id as chunk_id, d.filename, d.title, c.chunk_index, c.heading, c.content, ts_rank_cd(to_tsvector('simple', c.normalized_content), websearch_to_tsquery('simple', ${phrase}))::float8 as score
      from document_chunks c join documents d on d.id = c.document_id
      where d.workspace_id = ${id} and d.status = 'INDEXED'
        and (${allowedIds}::uuid[] is null or d.id = any(${allowedIds}::uuid[]))
        and (${filters?.year ?? null}::text is null or extract(year from d.document_date)::text = ${filters?.year ?? null})
        and (${filters?.date ?? null}::date is null or d.document_date = ${filters?.date ?? null}::date)
        and (${filters?.documentType ?? null}::text is null or d.document_type ilike ${filters?.documentType ? `%${filters.documentType}%` : null})
        and to_tsvector('simple', c.normalized_content) @@ websearch_to_tsquery('simple', ${phrase})
      order by ts_rank_cd(to_tsvector('simple', c.normalized_content), websearch_to_tsquery('simple', ${phrase})) desc, c.chunk_index asc limit ${limit}`;
    const anchorMap = new Map(extractLabeledNumericAnchors(query).map((anchor) => [anchor.label, anchor.value]));
    const pafta = anchorMap.get("pafta") ?? null;
    const ada = anchorMap.get("ada") ?? null;
    const parsel = anchorMap.get("parsel") ?? null;
    const anchorRows = pafta || ada || parsel ? await queryClient<LexicalRow[]>`
      select d.id as document_id, c.id as chunk_id, d.filename, d.title, c.chunk_index, c.heading, c.content, 1::float8 as score
      from document_chunks c join documents d on d.id = c.document_id
      where d.workspace_id = ${id} and d.status = 'INDEXED'
        and (${allowedIds}::uuid[] is null or d.id = any(${allowedIds}::uuid[]))
        and (${filters?.year ?? null}::text is null or extract(year from d.document_date)::text = ${filters?.year ?? null})
        and (${filters?.date ?? null}::date is null or d.document_date = ${filters?.date ?? null}::date)
        and (${filters?.documentType ?? null}::text is null or d.document_type ilike ${filters?.documentType ? `%${filters.documentType}%` : null})
        and (${pafta}::text is null or c.normalized_content ~ ${pafta ? `(^| )(${pafta} pafta|pafta( no)? ${pafta})( |$)` : null})
        and (${ada}::text is null or c.normalized_content ~ ${ada ? `(^| )(${ada} ada|ada( no)? ${ada})( |$)` : null})
        and (${parsel}::text is null or c.normalized_content ~ ${parsel ? `(^| )(${parsel} parsel|parsel( no)? ${parsel})( |$)` : null})
      order by d.filename asc, c.chunk_index asc limit ${limit}` : [];
    const merged = [...anchorRows, ...rows].filter((row, index, all) => all.findIndex((candidate) => candidate.chunk_id === row.chunk_id) === index).slice(0, limit);
    return merged.map((row) => ({ documentId: row.document_id, chunkId: row.chunk_id, documentName: documentName(row.filename), title: row.title, chunkIndex: row.chunk_index, heading: row.heading, content: row.content, sourceType: "LEXICAL" as const, score: Number(row.score) }));
  });
}

export async function getNeighborContext(config: ApiConfig, workspaceSlug: string, primary: SemanticContextChunk[], distance: number): Promise<SemanticContextChunk[]> {
  if (!primary.length || distance <= 0) return [];
  const documentIds = [...new Set(primary.filter((chunk) => chunk.chunkIndex >= 0).map((chunk) => chunk.documentId))];
  if (!documentIds.length) return [];
  const wanted = new Map<string, Set<number>>();
  for (const chunk of primary) {
    if (chunk.chunkIndex < 0) continue;
    const indexes = wanted.get(chunk.documentId) ?? new Set<number>();
    for (let offset = -distance; offset <= distance; offset++) if (offset !== 0 && chunk.chunkIndex + offset >= 0) indexes.add(chunk.chunkIndex + offset);
    wanted.set(chunk.documentId, indexes);
  }
  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slugify(workspaceSlug));
    const rows = await db.select({ documentId: documents.id, chunkId: documentChunks.id, filename: documents.filename, title: documents.title, chunkIndex: documentChunks.chunkIndex, heading: documentChunks.heading, content: documentChunks.content })
      .from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(and(eq(documents.workspaceId, id), inArray(documents.id, documentIds)));
    return rows.filter((row) => wanted.get(row.documentId)?.has(row.chunkIndex)).map((row) => ({
      ...row, documentName: documentName(row.filename), sourceType: "SEMANTIC" as const, score: 0, retrievers: ["NEIGHBOR"]
    }));
  });
}
