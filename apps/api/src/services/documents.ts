import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { SavedMultipartFile } from "@fastify/multipart";
import type { MetadataValue } from "@knowledgeos/shared";
import { claims, createDatabaseClient, documentChunks, documentEntities, documentFieldValues, documents, entities as entityTable, propertyReferences, relationships, workspaceFields, workspaces } from "@knowledgeos/database";
import { buildAliasExtractionPrompt, buildClaimExtractionPrompt, buildRelationshipExtractionPrompt, buildSummaryExtractionPrompt, type LLMClaim, type LLMExtractionResult, type LLMRelationship } from "@knowledgeos/ai";
import { ingestMarkdown, parseMarkdownFrontmatter, type IngestionResult } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import { ensureWorkspaceStorage, getWorkspaceStoragePaths, writeFileAtomically, writeWorkspaceMetadata } from "./storage.js";
import { metadataEntityCandidates, replaceDocumentClaims, replaceDocumentEntities, replaceDocumentPropertyReferences, replaceDocumentRelationships, type EntityAliasInput } from "./entities.js";
import { getLlmProviderForSelection } from "./ai-providers.js";
import { initialIndexingStageResults, resolveIndexingPlan, type IndexingPlan, type IndexingRequestMode, type IndexingStageName } from './indexing-plan.js';
import { getWorkspaceIngestionSettings, matchesIngestionSettings, type WorkspaceIngestionSettings } from "./workspace-settings.js";
import { ragRetrievalCache } from "./rag-cache.js";
import { canonicalizeDateValue, getWorkspaceFieldDefinitions, replaceDocumentFieldValues } from "./workspace-fields.js";
import { inspectIngestionQuality, type IngestionQualityReport } from "./ingestion-quality.js";
import { correctOcrChunks } from "./ocr-correction.js";

const markdownExtensions = new Set([".md", ".txt"]); const originalExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff"]);
export type UploadedDocument = { workspaceSlug: string; documentName: string; filename: string; title: string; hash: string; markdownPath: string; sourceOriginalPath: string | null; metadataPath: string; status: "UPLOADED" };
export type IndexedDocumentMetadata = Omit<UploadedDocument, "status"> & { status: "INDEXED"; indexedAt: string; ingestion: IngestionResult; quality: IngestionQualityReport; ingestionSettings?: WorkspaceIngestionSettings; llmExtraction?: LLMExtractionResult; llmExtractionError?: string; indexingPlan?: IndexingPlan; stageResults?: ReturnType<typeof initialIndexingStageResults>; summary?: string; indexCleared?: boolean };
export type DocumentListItem = { documentName: string; workspaceSlug: string; filename: string; title: string; status: "UPLOADED" | "INDEXED"; indexedAt: string | null; markdownPath: string; sourceOriginalPath: string | null; chunkCount: number; entityCount: number; hasLlmExtraction: boolean; llmExtractionError: string | null };
export type DocumentDetail = DocumentListItem & { hash: string; summary: string | null; markdown: string; quality: IngestionQualityReport; chunks: Array<{ chunkIndex: number; heading: string; tokenCount: number; content: string }>; entities: Array<{ type: string; value: string; confidence: number; source: string; evidenceSnippet: string }> };
export type UploadConflict = { filename: string; documentName: string; status: "NEW" | "DUPLICATE" | "CONFLICT" };
const safeFileName = (filename: string) => `${slugify(path.parse(filename).name)}${path.extname(filename).toLowerCase()}`;
const safeOriginalFileName = (markdownFilename: string, originalFilename: string) => `${path.parse(safeFileName(markdownFilename)).name}${path.extname(originalFilename).toLowerCase()}`;
const nameOf = (filename: string) => slugify(path.parse(filename).name);
const chunkContentHash = (content: string) => createHash("sha256").update(content).digest("hex");
async function withDb<T>(config: ApiConfig, fn: (client: ReturnType<typeof createDatabaseClient>) => Promise<T>) { const client = createDatabaseClient(config.databaseUrl); try { return await fn(client); } finally { await client.close(); } }
async function ensureWorkspace(db: any, config: ApiConfig, slug: string) { const [found] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1); if (found) return found; const paths = await ensureWorkspaceStorage(config.storageRoot, slug); const [created] = await db.insert(workspaces).values({ name: slug, slug, storagePath: paths.root }).onConflictDoNothing().returning(); if (created) return created; const [raced] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1); if (!raced) throw new Error("Unable to create workspace."); return raced; }
function uploaded(row: typeof documents.$inferSelect, slug: string): UploadedDocument { return { workspaceSlug: slug, documentName: nameOf(row.filename), filename: row.filename, title: row.title, hash: row.hash, markdownPath: row.markdownPath, sourceOriginalPath: row.sourceOriginalPath, metadataPath: "", status: "UPLOADED" }; }
function listItem(row: typeof documents.$inferSelect, slug: string, chunks = 0, entityCount = 0): DocumentListItem { return { ...uploaded(row, slug), status: row.status === "INDEXED" ? "INDEXED" : "UPLOADED", indexedAt: row.indexedAt?.toISOString() ?? null, chunkCount: chunks, entityCount, hasLlmExtraction: Boolean(row.llmExtraction), llmExtractionError: row.llmExtractionError }; }
function scalar(metadata: Record<string, MetadataValue>, key: string) { const value = metadata[key]; return typeof value === "string" && value.trim() ? value.trim() : null; }
function documentDate(metadata: Record<string, MetadataValue>) {
  const value = scalar(metadata, "date");
  return value ? canonicalizeDateValue(value) : null;
}
function recoverFrontmatter(
  stored: unknown,
  rows: Array<{ type: string; value: string; confidence: number; evidenceSnippet: string }>
) {
  const metadata = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, MetadataValue> : {};
  if (Object.keys(metadata).length) return metadata;
  const keys: Record<string, string> = {
    PERSON: "people", PLACE: "places", PARCEL: "parcels", PROPERTY: "property_descriptions",
    ORGANIZATION: "organizations", DOCUMENT_TYPE: "document_type", DATE: "dates",
    CASE_NUMBER: "case_numbers", NOTARY_NUMBER: "notary_numbers", KEYWORD: "keywords"
  };
  const recovered: Record<string, MetadataValue> = {};
  for (const row of rows) {
    if (row.confidence < 0.95 || !row.evidenceSnippet.startsWith("frontmatter:")) continue;
    const evidenceKey = row.evidenceSnippet.slice("frontmatter:".length);
    const key = /^(people|places|addresses|parcels|property_descriptions|organizations|document_type|date|date_text|case_numbers|notary_numbers|keywords)$/u.test(evidenceKey)
      ? evidenceKey
      : keys[row.type];
    if (!key) continue;
    const current = recovered[key];
    recovered[key] = [...new Set([...(Array.isArray(current) ? current : current ? [current] : []), row.value])];
  }
  for (const scalarKey of ["document_type", "date", "date_text"]) {
    const current = recovered[scalarKey];
    if (Array.isArray(current) && current.length === 1) recovered[scalarKey] = current[0];
  }
  return recovered;
}
function chunksMatch(
  stored: Array<{ chunkIndex: number; heading: string | null; content: string; normalizedContent: string; tokenCount: number }>,
  generated: IngestionResult["chunks"]
) {
  return stored.length === generated.length && stored.every((chunk, index) => {
    const next = generated[index];
    return next
      && chunk.chunkIndex === next.chunkIndex
      && chunk.heading === next.heading
      && chunk.content === next.content
      && chunk.normalizedContent === next.normalizedContent
      && chunk.tokenCount === next.tokenCount;
  });
}

async function snapshotFile(filePath: string) {
  try { return await readFile(filePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function restoreFileSnapshot(filePath: string, contents: Buffer | null) {
  if (contents) return writeFileAtomically(filePath, contents);
  try { await unlink(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function checkUploadConflicts(config: ApiConfig, input: { workspaceSlug?: string; files: Array<{ filename: string; hash: string }> }): Promise<UploadConflict[]> { const slug = slugify(input.workspaceSlug?.trim() || "inbox"); return withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); return Promise.all(input.files.map(async (file) => { const filename = safeFileName(file.filename); const [row] = await db.select().from(documents).where(and(eq(documents.workspaceId, ws.id), eq(documents.filename, filename))).limit(1); return !row || row.status === "UPLOADED" ? { filename: file.filename, documentName: nameOf(filename), status: "NEW" } : { filename: file.filename, documentName: nameOf(filename), status: row.hash === file.hash ? "DUPLICATE" : "CONFLICT" }; })); }); }
export async function getStoredDocumentHash(config: ApiConfig, input: { workspaceSlug?: string; filename: string }) { const slug = slugify(input.workspaceSlug?.trim() || "inbox"); return withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const filename = safeFileName(input.filename); const [row] = await db.select().from(documents).where(and(eq(documents.workspaceId, ws.id), eq(documents.filename, filename))).limit(1); return { documentName: nameOf(filename), hash: row?.status === "INDEXED" ? row.hash : null, status: row?.status === "INDEXED" ? row.status : null }; }); }
export async function listStoredDocuments(config: ApiConfig, workspaceSlug: string): Promise<DocumentListItem[]> { const slug = slugify(workspaceSlug || "merter-arsivi"); return withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const rows = await db.select({ document: documents, chunks: sql<number>`count(distinct ${documentChunks.id})`, entities: sql<number>`count(distinct ${documentEntities.id})` }).from(documents).leftJoin(documentChunks, eq(documentChunks.documentId, documents.id)).leftJoin(documentEntities, eq(documentEntities.documentId, documents.id)).where(eq(documents.workspaceId, ws.id)).groupBy(documents.id).orderBy(documents.filename); return rows.map((row) => listItem(row.document, slug, Number(row.chunks), Number(row.entities))); }); }
export async function getStoredDocumentDetail(config: ApiConfig, input: { workspaceSlug: string; documentName: string }): Promise<DocumentDetail> { const slug = slugify(input.workspaceSlug || "merter-arsivi"), wanted = slugify(input.documentName); return withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const rows = await db.select().from(documents).where(eq(documents.workspaceId, ws.id)); const row = rows.find((item) => nameOf(item.filename) === wanted); if (!row) throw new HttpError(404, "Document not found."); const [chunks, entityRows, markdown] = await Promise.all([db.select().from(documentChunks).where(eq(documentChunks.documentId, row.id)).orderBy(documentChunks.chunkIndex), db.select({ type: workspaceFields.label, value: entityTable.canonicalValue, confidence: documentEntities.confidence, evidenceSnippet: documentEntities.evidenceSnippet, source: documentEntities.source }).from(documentEntities).innerJoin(entityTable, eq(entityTable.id, documentEntities.entityId)).innerJoin(workspaceFields, eq(workspaceFields.id, entityTable.fieldId)).where(eq(documentEntities.documentId, row.id)), readFile(row.markdownPath, "utf8")]); return { ...listItem(row, slug, chunks.length, entityRows.length), hash: row.hash, summary: row.summary, markdown, quality: inspectIngestionQuality(chunks as unknown as IngestionResult["chunks"]), chunks: chunks.map((chunk) => ({ chunkIndex: chunk.chunkIndex, heading: chunk.heading ?? wanted, tokenCount: chunk.tokenCount, content: chunk.content })), entities: entityRows }; }); }
export async function getStoredDocumentStatuses(config: ApiConfig, input: { workspaceSlug: string; documentNames: string[] }) { const items = await listStoredDocuments(config, input.workspaceSlug); return input.documentNames.map((value) => ({ documentName: slugify(value), status: items.find((item) => item.documentName === slugify(value))?.status ?? "MISSING" as const })); }

export async function storeUploadedDocument(config: ApiConfig, input: { workspaceSlug?: string; title?: string; markdownFile: SavedMultipartFile; originalFile?: SavedMultipartFile; signal?: AbortSignal }): Promise<UploadedDocument> {
  if (input.signal?.aborted) throw new HttpError(499, "Upload cancelled.");
  if (!markdownExtensions.has(path.extname(input.markdownFile.filename).toLowerCase())) throw new HttpError(400, "Markdown file must be .md or .txt.");
  if (input.originalFile && !originalExtensions.has(path.extname(input.originalFile.filename).toLowerCase())) throw new HttpError(400, "Original scan must be PDF, JPG, PNG, TIFF, or TIF.");

  const slug = slugify(input.workspaceSlug?.trim() || "inbox");
  const paths = await ensureWorkspaceStorage(config.storageRoot, slug);
  const filename = safeFileName(input.markdownFile.filename);
  const markdownPath = path.join(paths.markdown, filename);
  const markdown = await readFile(input.markdownFile.filepath);
  const hash = createHash("sha256").update(markdown).digest("hex");
  const originalPath = input.originalFile ? path.join(paths.originals, safeOriginalFileName(input.markdownFile.filename, input.originalFile.filename)) : null;
  const original = input.originalFile ? await readFile(input.originalFile.filepath) : null;
  const parsed = parseMarkdownFrontmatter(markdown.toString("utf8"));
  const title = input.title?.trim() || scalar(parsed.frontmatter, "title") || path.parse(input.markdownFile.filename).name;
  const documentType = scalar(parsed.frontmatter, "document_type");
  const date = documentDate(parsed.frontmatter);

  // A conflict must be rejected before touching the stored source files.
  await withDb(config, async ({ db }) => {
    const ws = await ensureWorkspace(db, config, slug);
    const [existing] = await db.select().from(documents).where(and(eq(documents.workspaceId, ws.id), eq(documents.filename, filename))).limit(1);
    if (existing?.status === "INDEXED") throw new HttpError(409, existing.hash === hash ? "This file has already been uploaded." : "A file with this name already exists and has different content.");
  });

  const [previousMarkdown, previousOriginal] = await Promise.all([
    snapshotFile(markdownPath),
    originalPath ? snapshotFile(originalPath) : Promise.resolve(null)
  ]);

  try {
    if (input.signal?.aborted) throw new HttpError(499, "Upload cancelled.");
    await writeFileAtomically(markdownPath, markdown);
    if (originalPath && original) await writeFileAtomically(originalPath, original);
    if (input.signal?.aborted) throw new HttpError(499, "Upload cancelled.");

    const saved = await withDb(config, async ({ db }) => db.transaction(async (tx) => {
      const ws = await ensureWorkspace(tx, config, slug);
      const [existing] = await tx.select().from(documents).where(and(eq(documents.workspaceId, ws.id), eq(documents.filename, filename))).limit(1);
      if (existing?.status === "INDEXED") throw new HttpError(409, existing.hash === hash ? "This file has already been uploaded." : "A file with this name already exists and has different content.");
      const [row] = await tx.insert(documents).values({ workspaceId: ws.id, filename, title, content: parsed.content, normalizedContent: parsed.content, sourceOriginalPath: originalPath, markdownPath, hash, metadata: parsed.frontmatter, ingestionSettings: {}, documentType, documentDate: date, embeddingModel: null, status: "UPLOADED", indexedAt: null, summary: null, llmExtraction: null, llmExtractionError: null }).onConflictDoUpdate({ target: [documents.workspaceId, documents.filename], set: { title, content: parsed.content, normalizedContent: parsed.content, sourceOriginalPath: originalPath, markdownPath, hash, metadata: parsed.frontmatter, ingestionSettings: {}, documentType, documentDate: date, embeddingModel: null, status: "UPLOADED", indexedAt: null, summary: null, llmExtraction: null, llmExtractionError: null, updatedAt: new Date() } }).returning();
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, row.id));
      await tx.delete(documentEntities).where(eq(documentEntities.documentId, row.id));
      await tx.delete(propertyReferences).where(eq(propertyReferences.documentId, row.id));
      await tx.delete(relationships).where(eq(relationships.documentId, row.id));
      await tx.delete(entityTable).where(and(
        inArray(entityTable.fieldId, tx.select({ id: workspaceFields.id }).from(workspaceFields).where(eq(workspaceFields.workspaceId, ws.id))),
        sql`not exists (select 1 from ${documentEntities} de where de.entity_id = ${entityTable.id})`
      ));
      return { row, previousOriginalPath: existing?.sourceOriginalPath ?? null };
    }));

    await replaceDocumentFieldValues(config, slug, saved.row.id, parsed.frontmatter);
    if (saved.previousOriginalPath && saved.previousOriginalPath !== originalPath) await unlink(saved.previousOriginalPath).catch(() => undefined);
    await writeWorkspaceMetadata(paths, { slug, storagePath: paths.root, updatedAt: new Date().toISOString() }).catch(() => undefined);
    return uploaded(saved.row, slug);
  } catch (error) {
    await Promise.all([
      restoreFileSnapshot(markdownPath, previousMarkdown),
      originalPath ? restoreFileSnapshot(originalPath, previousOriginal) : Promise.resolve()
    ]).catch(() => undefined);
    throw error;
  }
}
export async function discardUnindexedDocuments(config: ApiConfig, input: { workspaceSlug: string; documentNames: string[] }) { const slug = slugify(input.workspaceSlug); return withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const rows = await db.select().from(documents).where(and(eq(documents.workspaceId, ws.id), eq(documents.status, "UPLOADED"))); const selected = rows.filter((row) => input.documentNames.map(slugify).includes(nameOf(row.filename))); await Promise.all(selected.map((row) => unlink(row.markdownPath).catch(() => undefined))); if (selected.length) await db.delete(documents).where(inArray(documents.id, selected.map((row) => row.id))); }); }
export async function reindexStoredDocument(
  config: ApiConfig,
  input: { workspaceSlug: string; documentName: string; mode?: IndexingRequestMode; requestedStages?: Partial<Record<IndexingStageName, boolean>>; plan?: IndexingPlan; signal?: AbortSignal; invalidateSemanticIndex?: boolean; onProgress?: (stage: string) => void }
): Promise<IndexedDocumentMetadata> {
  const slug = slugify(input.workspaceSlug);
  const wanted = slugify(input.documentName);
  const result = await withDb(config, async ({ db }) => {
    const ws = await ensureWorkspace(db, config, slug);
    const candidates = await db.select().from(documents).where(eq(documents.workspaceId, ws.id));
    const document = candidates.find((row) => nameOf(row.filename) === wanted);
    if (!document) throw new HttpError(404, "Document not found.");
    input.onProgress?.("Preparing document");
    const existingChunks = await db.select({
      chunkIndex: documentChunks.chunkIndex,
      heading: documentChunks.heading,
      content: documentChunks.content,
      normalizedContent: documentChunks.normalizedContent,
      tokenCount: documentChunks.tokenCount,
      contentHash: documentChunks.contentHash,
      embedding: documentChunks.embedding,
      embeddingModel: documentChunks.embeddingModel
    }).from(documentChunks).where(eq(documentChunks.documentId, document.id)).orderBy(documentChunks.chunkIndex);
    const markdown = await readFile(document.markdownPath, "utf8");
    const settings = await getWorkspaceIngestionSettings(config, slug);
    const storedMetadata = document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
      ? document.metadata as Record<string, MetadataValue>
      : {};
    const initialIngestion = ingestMarkdown(markdown, { targetWords: settings.chunkSize, overlapWords: settings.chunkOverlap }, storedMetadata);
    const initialQuality = inspectIngestionQuality(initialIngestion.chunks);
    const correctedChunks = await correctOcrChunks(config, { chunks: initialIngestion.chunks, quality: initialQuality, signal: input.signal });
    const ingestion = correctedChunks === initialIngestion.chunks ? initialIngestion : { ...initialIngestion, chunks: correctedChunks };
    const quality = inspectIngestionQuality(ingestion.chunks);
    const preserveChunks = document.status === "INDEXED" && chunksMatch(existingChunks, ingestion.chunks);
    const reusableEmbeddings = new Map(existingChunks
      .filter((chunk) => chunk.embedding && chunk.embeddingModel)
      .map((chunk) => [chunk.contentHash, { embedding: chunk.embedding, embeddingModel: chunk.embeddingModel }]));
    const reusableModels = ingestion.chunks.map((chunk) => reusableEmbeddings.get(chunkContentHash(chunk.content))?.embeddingModel);
    const fullyReusedModel = reusableModels.length > 0 && reusableModels.every((model) => model && model === reusableModels[0])
      ? reusableModels[0]
      : null;
    if (input.signal?.aborted) throw new Error("Reindexing cancelled.");
    input.onProgress?.("Saving index");
    await db.transaction(async (tx) => {
      if (!preserveChunks) await tx.delete(documentChunks).where(eq(documentChunks.documentId, document.id));
      await tx.update(documents).set({
        title: scalar(ingestion.frontmatter, "title") ?? document.title,
        content: ingestion.content,
        normalizedContent: ingestion.normalizedContent,
        metadata: ingestion.frontmatter,
        ingestionSettings: { ...settings, entityLinkerModel: config.entityLinkerModel },
        summary: scalar(ingestion.frontmatter, "summary"),
        llmExtraction: null,
        llmExtractionError: null,
        documentType: scalar(ingestion.frontmatter, "document_type"),
        documentDate: documentDate(ingestion.frontmatter),
        embeddingModel: preserveChunks ? document.embeddingModel : fullyReusedModel,
        status: "INDEXED",
        indexedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(documents.id, document.id));
      if (!preserveChunks && ingestion.chunks.length) await tx.insert(documentChunks).values(ingestion.chunks.map((chunk) => {
        const contentHash = chunkContentHash(chunk.content);
        const reusable = reusableEmbeddings.get(contentHash);
        return {
          documentId: document.id,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          normalizedContent: chunk.normalizedContent,
          contentHash,
          tokenCount: chunk.tokenCount,
          embedding: reusable?.embedding,
          embeddingModel: reusable?.embeddingModel
        };
      }));
    });
    input.onProgress?.("Updating entity index");
    await replaceDocumentFieldValues(config, slug, document.id, ingestion.frontmatter);
    const fields = await getWorkspaceFieldDefinitions(config, slug);
    const plan = input.plan ?? resolveIndexingPlan(config, { mode: input.mode, workspaceId: ws.id, documentId: document.id, hasFrontmatter: Object.keys(ingestion.frontmatter).length > 0, chunkCount: ingestion.chunks.length, requestedStages: input.requestedStages });
    const stageResults = initialIndexingStageResults(plan);
    const deterministicEntities = [...ingestion.entities, ...metadataEntityCandidates(ingestion.frontmatter, fields)];
    const entitiesStartedAt = new Date().toISOString();
    await replaceDocumentEntities(config, slug, document.id, deterministicEntities);
    stageResults.entities = { ...stageResults.entities, status: 'succeeded', startedAt: entitiesStartedAt, completedAt: new Date().toISOString(), inputCandidateCount: deterministicEntities.length, acceptedCount: deterministicEntities.length };
    await replaceDocumentPropertyReferences(config, slug, document.id, ingestion.propertyReferences);
    let llmExtraction: LLMExtractionResult | undefined;
    const graphStages = ['aliases', 'relationships', 'claims', 'summary'] as const;
    const generated: LLMExtractionResult = { people: [], aliases: [], places: [], parcels: [], dates: [], organizations: [], documentType: null, relationships: [], claims: [], summary: '' };
    const stageErrors: string[] = [];
    const entityNames = [...new Set(deterministicEntities.map((entity) => entity.value.trim()).filter(Boolean))];
    const executeGraphStage = async <T>(stage: typeof graphStages[number], prompt: string, apply: (result: T) => Promise<void> | void) => {
      const decision = plan.stages[stage];
      if (decision.execution === 'skip') return;
      const startedAt = new Date().toISOString();
      stageResults[stage] = { ...stageResults[stage], status: 'running', startedAt };
      try {
        const selection = decision.provider === 'ollama' ? decision.model! : `${decision.provider}/${decision.model}`;
        const result = await getLlmProviderForSelection(config, selection).generateJsonObject<T>(prompt, input.signal);
        await apply(result);
        const applied = stageResults[stage];
        stageResults[stage] = { ...applied, status: applied.status === 'succeeded_with_warnings' ? 'succeeded_with_warnings' : 'succeeded', completedAt: new Date().toISOString() };
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1_000) : `${stage} extraction failed.`;
        stageErrors.push(`${stage}: ${message}`);
        stageResults[stage] = { ...stageResults[stage], status: 'failed', completedAt: new Date().toISOString(), error: message };
      }
    };
    if (graphStages.some((stage) => plan.stages[stage].execution !== 'skip')) {
      input.onProgress?.("Extracting planned graph stages");
      await executeGraphStage<{ aliases?: Array<{ canonical?: string; aliases?: string[] }> }>('aliases', buildAliasExtractionPrompt(ingestion.content, entityNames), async (result) => {
        const aliases: EntityAliasInput[] = (result.aliases ?? []).flatMap((group) => (group.aliases ?? []).map((alias) => ({ canonical: group.canonical?.trim() ?? '', alias: alias.trim(), confidence: 0.8, source: 'LLM' as const }))).filter((alias) => alias.canonical && alias.alias);
        generated.aliases = (result.aliases ?? []).flatMap((group) => (group.aliases ?? []).length ? [{ canonical: group.canonical ?? '', aliases: group.aliases ?? [] }] : []);
        const persisted = await replaceDocumentEntities(config, slug, document.id, deterministicEntities, aliases);
        const warnings = persisted.inputCandidateCount > 0 && persisted.acceptedCount === 0 ? ['All alias candidates were rejected.'] : undefined;
        stageResults.aliases = { ...stageResults.aliases, status: warnings ? 'succeeded_with_warnings' : 'succeeded', inputCandidateCount: persisted.inputCandidateCount, acceptedCount: persisted.acceptedCount, rejectedCount: persisted.rejectedCount, rejectionCounts: persisted.rejectionCounts, warnings };
      });
      await executeGraphStage<{ relationships?: LLMRelationship[] }>('relationships', buildRelationshipExtractionPrompt(ingestion.content, entityNames), async (result) => {
        generated.relationships = result.relationships ?? [];
        const persisted = await replaceDocumentRelationships(config, slug, document.id, generated.relationships);
        const warnings = persisted.inputCandidateCount > 0 && persisted.acceptedCount === 0 ? ['All relationship candidates were rejected; existing graph rows were preserved.'] : undefined;
        stageResults.relationships = { ...stageResults.relationships, status: warnings ? 'succeeded_with_warnings' : 'succeeded', inputCandidateCount: persisted.inputCandidateCount, acceptedCount: persisted.acceptedCount, rejectedCount: persisted.rejectedCount, rejectionCounts: persisted.rejectionCounts, warnings };
      });
      await executeGraphStage<{ claims?: LLMClaim[] }>('claims', buildClaimExtractionPrompt(ingestion.content), async (result) => {
        generated.claims = result.claims ?? [];
        const persisted = await replaceDocumentClaims(config, slug, document.id, generated.claims);
        const warnings = persisted.inputCandidateCount > 0 && persisted.acceptedCount === 0 ? ['All claim candidates were rejected; existing graph rows were preserved.'] : undefined;
        stageResults.claims = { ...stageResults.claims, status: warnings ? 'succeeded_with_warnings' : 'succeeded', inputCandidateCount: persisted.inputCandidateCount, acceptedCount: persisted.acceptedCount, rejectedCount: persisted.rejectedCount, rejectionCounts: persisted.rejectionCounts, warnings };
      });
      await executeGraphStage<{ summary?: string }>('summary', buildSummaryExtractionPrompt(ingestion.content), (result) => {
        generated.summary = result.summary?.trim() ?? '';
      });
      llmExtraction = generated;
    }
    const llmExtractionError = stageErrors.length ? stageErrors.join('; ') : undefined;
    await db.update(documents).set({ llmExtraction: llmExtraction ?? null, llmExtractionError: llmExtractionError ?? null, summary: llmExtraction?.summary || scalar(ingestion.frontmatter, "summary") }).where(eq(documents.id, document.id));
    return { document, ingestion, quality, settings, llmExtraction, llmExtractionError, plan, stageResults };
  });
  ragRetrievalCache.invalidateWorkspace(slug);
  return {
    ...uploaded(result.document, slug),
    status: "INDEXED",
    indexedAt: new Date().toISOString(),
    ingestion: result.ingestion,
    quality: result.quality,
    llmExtraction: result.llmExtraction,
    llmExtractionError: result.llmExtractionError,
    indexingPlan: result.plan,
    stageResults: result.stageResults,
    ingestionSettings: result.settings,
    summary: scalar(result.ingestion.frontmatter, "summary") ?? undefined
  };
}
export async function clearWorkspaceIndexes(config: ApiConfig, workspaceSlug: string) { const slug = slugify(workspaceSlug || "merter-arsivi"); const result = await withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const rows = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.workspaceId, ws.id), eq(documents.status, "INDEXED"))); const fields = await db.select({ id: workspaceFields.id }).from(workspaceFields).where(eq(workspaceFields.workspaceId, ws.id)); await db.transaction(async (tx) => { if (rows.length) await tx.delete(documentChunks).where(inArray(documentChunks.documentId, rows.map((r) => r.id))); if (rows.length) await tx.delete(documentEntities).where(inArray(documentEntities.documentId, rows.map((r) => r.id))); if (rows.length) await tx.delete(documentFieldValues).where(inArray(documentFieldValues.documentId, rows.map((r) => r.id))); if (rows.length) await tx.delete(propertyReferences).where(inArray(propertyReferences.documentId, rows.map((r) => r.id))); if (fields.length) await tx.delete(entityTable).where(inArray(entityTable.fieldId, fields.map((field) => field.id))); await tx.update(documents).set({ status: "UPLOADED", embeddingModel: null, indexedAt: null, summary: null, llmExtraction: null, llmExtractionError: null }).where(eq(documents.workspaceId, ws.id)); }); return { workspaceSlug: slug, documentCount: rows.length }; }); ragRetrievalCache.invalidateWorkspace(slug); return result; }
export async function clearWorkspaceDocuments(config: ApiConfig, workspaceSlug: string) { const slug = slugify(workspaceSlug || "merter-arsivi"); await ensureWorkspaceStorage(config.storageRoot, slug); const rows = await withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const stored = await db.select().from(documents).where(eq(documents.workspaceId, ws.id)); await db.transaction(async (tx) => { await tx.delete(documents).where(eq(documents.workspaceId, ws.id)); await tx.delete(workspaceFields).where(eq(workspaceFields.workspaceId, ws.id)); }); return stored; }); ragRetrievalCache.invalidateWorkspace(slug); await Promise.all(rows.flatMap((row) => [unlink(row.markdownPath).then(() => "markdown").catch(() => ""), row.sourceOriginalPath ? unlink(row.sourceOriginalPath).then(() => "original").catch(() => "") : Promise.resolve("")])); return { workspaceSlug: slug, documentCount: rows.length, markdownCount: rows.length, originalCount: rows.filter((row) => Boolean(row.sourceOriginalPath)).length }; }
export async function getWorkspaceReindexStatus(config: ApiConfig, workspaceSlug: string) { const slug = slugify(workspaceSlug || "merter-arsivi"), settings = await getWorkspaceIngestionSettings(config, workspaceSlug); return withDb(config, async ({ db }) => { const ws = await ensureWorkspace(db, config, slug); const rows = await db.select({ status: documents.status, ingestionSettings: documents.ingestionSettings }).from(documents).where(eq(documents.workspaceId, ws.id)); const staleDocumentCount = rows.filter((row) => { const snapshot = row.ingestionSettings as WorkspaceIngestionSettings & { entityLinkerModel?: string }; return row.status !== "INDEXED" || !matchesIngestionSettings(snapshot, settings) || snapshot.entityLinkerModel !== config.entityLinkerModel; }).length; return { documentCount: rows.length, staleDocumentCount, requiresReindex: staleDocumentCount > 0 }; }); }
export async function reindexWorkspaceDocuments(config: ApiConfig, workspaceSlug: string, options: { signal?: AbortSignal; mode?: IndexingRequestMode; requestedStages?: Partial<Record<IndexingStageName, boolean>>; onProgress?: (progress: { completed: number; total: number; documentName?: string }) => void } = {}) { const items = await listStoredDocuments(config, workspaceSlug); let completed = 0; for (const item of items) { if (options.signal?.aborted) throw new Error("Reindexing cancelled."); options.onProgress?.({ completed, total: items.length, documentName: item.documentName }); await reindexStoredDocument(config, { workspaceSlug, documentName: item.documentName, mode: options.mode, requestedStages: options.requestedStages, signal: options.signal }); completed++; } return { workspaceSlug: slugify(workspaceSlug), reindexedCount: completed }; }
