import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SavedMultipartFile } from "@fastify/multipart";
import {
  buildEntityExtractionPrompt,
  type LLMExtractionResult
} from "@knowledgeos/ai";
import { ingestMarkdown, parseMarkdownFrontmatter, type IngestionResult } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import {
  ensureWorkspaceStorage,
  getWorkspaceStoragePaths,
  writeFileAtomically,
  writeWorkspaceMetadata
} from "./storage.js";
import { rebuildEntityIndex } from "./entities.js";
import { getLlmProvider } from "./ai-providers.js";
import { getWorkspaceIngestionSettings, matchesIngestionSettings, type WorkspaceIngestionSettings } from "./workspace-settings.js";
import { invalidateSemanticIndex, rebuildSemanticIndex } from "./semantic-search.js";

const markdownExtensions = new Set([".md", ".txt"]);
const originalExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

export type UploadedDocument = {
  workspaceSlug: string;
  documentName: string;
  filename: string;
  title: string;
  hash: string;
  markdownPath: string;
  sourceOriginalPath: string | null;
  metadataPath: string;
  status: "UPLOADED";
};

export type IndexedDocumentMetadata = Omit<UploadedDocument, "status"> & {
  status: "INDEXED";
  indexedAt: string;
  ingestion: IngestionResult;
  ingestionSettings?: WorkspaceIngestionSettings;
  llmExtraction?: LLMExtractionResult;
  llmExtractionError?: string;
  summary?: string;
};

export type DocumentListItem = {
  documentName: string;
  workspaceSlug: string;
  filename: string;
  title: string;
  status: "UPLOADED" | "INDEXED";
  indexedAt: string | null;
  markdownPath: string;
  sourceOriginalPath: string | null;
  chunkCount: number;
  entityCount: number;
  hasLlmExtraction: boolean;
  llmExtractionError: string | null;
};

export type DocumentDetail = DocumentListItem & {
  hash: string;
  summary: string | null;
  markdown: string;
  chunks: Array<{
    chunkIndex: number;
    heading: string;
    tokenCount: number;
    content: string;
  }>;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
    source: string;
    evidenceSnippet: string;
  }>;
};

export type UploadConflict = {
  filename: string;
  documentName: string;
  status: "NEW" | "DUPLICATE" | "CONFLICT";
};

function safeFileName(filename: string) {
  const parsed = path.parse(filename);
  const base = slugify(parsed.name);
  const extension = parsed.ext.toLowerCase();

  return `${base}${extension}`;
}

export async function checkUploadConflicts(
  config: ApiConfig,
  input: { workspaceSlug?: string; files: Array<{ filename: string; hash: string }> }
): Promise<UploadConflict[]> {
  const workspaceSlug = slugify(input.workspaceSlug?.trim() || "inbox");
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  return Promise.all(input.files.map(async (file) => {
    const documentName = path.parse(safeFileName(file.filename)).name;
    try {
      const metadata = JSON.parse(await readFile(path.join(paths.metadata, `${documentName}.json`), "utf8")) as UploadedDocument | IndexedDocumentMetadata;
      return { filename: file.filename, documentName, status: metadata.hash === file.hash ? "DUPLICATE" : "CONFLICT" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { filename: file.filename, documentName, status: "NEW" };
      throw error;
    }
  }));
}

export async function listStoredDocuments(
  config: ApiConfig,
  workspaceSlugInput: string
): Promise<DocumentListItem[]> {
  const workspaceSlug = slugify(workspaceSlugInput || "merter-arsivi");
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const files = await readdir(paths.metadata);
  const documents: DocumentListItem[] = [];

  for (const fileName of files) {
    if (
      !fileName.endsWith(".json") ||
      fileName === "workspace.json" ||
      fileName === "entities.json" ||
      fileName === "embeddings.json"
    ) {
      continue;
    }

    const filePath = path.join(paths.metadata, fileName);
    const metadata = JSON.parse(await readFile(filePath, "utf8")) as
      | UploadedDocument
      | IndexedDocumentMetadata;

    documents.push({
      documentName: path.parse(fileName).name,
      workspaceSlug: metadata.workspaceSlug,
      filename: metadata.filename,
      title: metadata.title,
      status: metadata.status,
      indexedAt: metadata.status === "INDEXED" ? metadata.indexedAt : null,
      markdownPath: metadata.markdownPath,
      sourceOriginalPath: metadata.sourceOriginalPath,
      chunkCount:
        metadata.status === "INDEXED" ? metadata.ingestion.chunks.length : 0,
      entityCount:
        metadata.status === "INDEXED" ? metadata.ingestion.entities.length : 0,
      hasLlmExtraction:
        metadata.status === "INDEXED" && Boolean(metadata.llmExtraction),
      llmExtractionError:
        metadata.status === "INDEXED" ? metadata.llmExtractionError ?? null : null
    });
  }

  return documents.sort((left, right) =>
    left.documentName.localeCompare(right.documentName, "tr")
  );
}

function toDocumentListItem(
  documentName: string,
  metadata: UploadedDocument | IndexedDocumentMetadata
): DocumentListItem {
  return {
    documentName,
    workspaceSlug: metadata.workspaceSlug,
    filename: metadata.filename,
    title: metadata.title,
    status: metadata.status,
    indexedAt: metadata.status === "INDEXED" ? metadata.indexedAt : null,
    markdownPath: metadata.markdownPath,
    sourceOriginalPath: metadata.sourceOriginalPath,
    chunkCount: metadata.status === "INDEXED" ? metadata.ingestion.chunks.length : 0,
    entityCount:
      metadata.status === "INDEXED" ? metadata.ingestion.entities.length : 0,
    hasLlmExtraction:
      metadata.status === "INDEXED" && Boolean(metadata.llmExtraction),
    llmExtractionError:
      metadata.status === "INDEXED" ? metadata.llmExtractionError ?? null : null
  };
}

export async function getStoredDocumentDetail(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    documentName: string;
  }
): Promise<DocumentDetail> {
  const workspaceSlug = slugify(input.workspaceSlug || "merter-arsivi");
  const documentName = slugify(input.documentName);
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const metadataPath = path.join(paths.metadata, `${documentName}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as
    | UploadedDocument
    | IndexedDocumentMetadata;
  const markdown = await readFile(metadata.markdownPath, "utf8");
  const base = toDocumentListItem(documentName, metadata);

  return {
    ...base,
    hash: metadata.hash,
    summary: metadata.status === "INDEXED" ? metadata.summary ?? null : null,
    markdown,
    chunks:
      metadata.status === "INDEXED"
        ? metadata.ingestion.chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            heading: chunk.heading ?? documentName,
            tokenCount: chunk.tokenCount,
            content: chunk.content
          }))
        : [],
    entities:
      metadata.status === "INDEXED"
        ? metadata.ingestion.entities.map((entity) => ({
            type: entity.type,
            value: entity.value,
            confidence: entity.confidence,
            source: entity.source,
            evidenceSnippet: entity.evidenceSnippet
          }))
        : []
  };
}

export async function storeUploadedDocument(
  config: ApiConfig,
  input: {
    workspaceSlug?: string;
    title?: string;
    markdownFile: SavedMultipartFile;
    originalFile?: SavedMultipartFile;
  }
): Promise<UploadedDocument> {
  const markdownExtension = path.extname(input.markdownFile.filename).toLowerCase();

  if (!markdownExtensions.has(markdownExtension)) {
    throw new HttpError(400, "Markdown file must be .md or .txt.");
  }

  if (input.originalFile) {
    const originalExtension = path.extname(input.originalFile.filename).toLowerCase();

    if (!originalExtensions.has(originalExtension)) {
      throw new HttpError(
        400,
        "Original scan must be PDF, JPG, PNG, TIFF, or TIF."
      );
    }
  }

  const workspaceSlug = slugify(input.workspaceSlug?.trim() || "inbox");
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const markdownBuffer = await readFile(input.markdownFile.filepath);
  const hash = createHash("sha256").update(markdownBuffer).digest("hex");
  const markdownFileName = safeFileName(input.markdownFile.filename);
  const documentName = path.parse(markdownFileName).name;
  const markdownPath = path.join(paths.markdown, markdownFileName);

  const markdownWasNew = !existsSync(markdownPath);
  let markdownWritten = false;
  let originalWasNew = false;
  let originalWritten = false;
  let sourceOriginalPath: string | null = null;

  try {
    await writeFileAtomically(markdownPath, markdownBuffer);
    markdownWritten = true;

    if (input.originalFile) {
      const originalBuffer = await readFile(input.originalFile.filepath);
      sourceOriginalPath = path.join(paths.originals, safeFileName(input.originalFile.filename));
      originalWasNew = !existsSync(sourceOriginalPath);
      await writeFileAtomically(sourceOriginalPath, originalBuffer);
      originalWritten = true;
    }

    const frontmatterTitle = parseMarkdownFrontmatter(markdownBuffer.toString("utf8")).frontmatter.title;
    const title = input.title?.trim()
      || (typeof frontmatterTitle === "string" ? frontmatterTitle.trim() : "")
      || path.parse(input.markdownFile.filename).name;
    const metadataPath = path.join(paths.metadata, `${documentName}.json`);
    const metadata: UploadedDocument = {
      workspaceSlug,
      documentName,
      filename: input.markdownFile.filename,
      title,
      hash,
      markdownPath,
      sourceOriginalPath,
      metadataPath,
      status: "UPLOADED"
    };

    await writeFileAtomically(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await writeWorkspaceMetadata(paths, {
      slug: workspaceSlug,
      storagePath: paths.root,
      updatedAt: new Date().toISOString()
    });
    return metadata;
  } catch (error) {
    if (markdownWritten && markdownWasNew) await unlink(markdownPath).catch(() => undefined);
    if (originalWritten && originalWasNew && sourceOriginalPath) await unlink(sourceOriginalPath).catch(() => undefined);
    throw error;
  }
}

export async function reindexStoredDocument(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    documentName: string;
    useLlm?: boolean;
    signal?: AbortSignal;
    onProgress?: (stage: string) => void;
  }
): Promise<IndexedDocumentMetadata> {
  const workspaceSlug = slugify(input.workspaceSlug);
  const documentName = slugify(input.documentName);
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  const metadataPath = path.join(paths.metadata, `${documentName}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as UploadedDocument | IndexedDocumentMetadata;
  const {
    status: _previousStatus,
    indexedAt: _previousIndexedAt,
    ingestion: _previousIngestion,
    ingestionSettings: _previousIngestionSettings,
    llmExtraction: _previousLlmExtraction,
    llmExtractionError: _previousLlmExtractionError,
    summary: _previousSummary,
    ...uploadedMetadata
  } = metadata as IndexedDocumentMetadata;
  const markdown = await readFile(metadata.markdownPath, "utf8");
  input.onProgress?.("Preparing document");
  const ingestionSettings = await getWorkspaceIngestionSettings(config, workspaceSlug);
  const ingestion = ingestMarkdown(markdown, {
    targetWords: ingestionSettings.chunkSize,
    overlapWords: ingestionSettings.chunkOverlap
  });
  const indexedMetadata: IndexedDocumentMetadata = {
    ...uploadedMetadata,
    status: "INDEXED",
    indexedAt: new Date().toISOString(),
    ingestion,
    ingestionSettings,
    llmExtractionError: undefined
  };

  if (input.useLlm) {
    try {
      input.onProgress?.("Waiting for AI response");
      const provider = getLlmProvider(config, "extraction");
      const llmExtraction = await provider.generateJson<LLMExtractionResult>(
        buildEntityExtractionPrompt(ingestion.content),
        input.signal
      );
      indexedMetadata.llmExtraction = llmExtraction;
      indexedMetadata.summary = llmExtraction.summary;
    } catch (error) {
      indexedMetadata.llmExtractionError =
        input.signal?.aborted
          ? "LLM extraction cancelled by user."
          : error instanceof Error ? error.message : "Unknown LLM extraction error.";
    }
  }

  input.onProgress?.("Saving index");
  await writeFileAtomically(metadataPath, `${JSON.stringify(indexedMetadata, null, 2)}\n`);
  await invalidateSemanticIndex(config, workspaceSlug);
  input.onProgress?.("Updating entity index");
  await rebuildEntityIndex(config, workspaceSlug);

  return indexedMetadata;
}

export async function getWorkspaceReindexStatus(config: ApiConfig, workspaceSlugInput: string) {
  const workspaceSlug = slugify(workspaceSlugInput || "merter-arsivi");
  const settings = await getWorkspaceIngestionSettings(config, workspaceSlug);
  const documents = await listStoredDocuments(config, workspaceSlug);
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  let staleDocumentCount = 0;

  for (const document of documents) {
    if (document.status !== "INDEXED") {
      staleDocumentCount += 1;
      continue;
    }
    const metadata = JSON.parse(await readFile(path.join(paths.metadata, `${document.documentName}.json`), "utf8")) as IndexedDocumentMetadata;
    if (!matchesIngestionSettings(metadata.ingestionSettings, settings)) staleDocumentCount += 1;
  }

  return { documentCount: documents.length, staleDocumentCount, requiresReindex: staleDocumentCount > 0 };
}

export async function reindexWorkspaceDocuments(
  config: ApiConfig,
  workspaceSlugInput: string,
  options: { signal?: AbortSignal; useLlm?: boolean; onProgress?: (progress: { completed: number; total: number; documentName?: string }) => void } = {}
) {
  const workspaceSlug = slugify(workspaceSlugInput || "merter-arsivi");
  const documents = await listStoredDocuments(config, workspaceSlug);
  let reindexedCount = 0;
  for (const document of documents) {
    if (options.signal?.aborted) throw new Error("Reindexing cancelled.");
    options.onProgress?.({ completed: reindexedCount, total: documents.length, documentName: document.documentName });
    await reindexStoredDocument(config, { workspaceSlug, documentName: document.documentName, useLlm: options.useLlm === true, signal: options.signal });
    reindexedCount += 1;
    options.onProgress?.({ completed: reindexedCount, total: documents.length, documentName: document.documentName });
  }
  if (options.signal?.aborted) throw new Error("Reindexing cancelled.");
  if (reindexedCount > 0) await rebuildSemanticIndex(config, workspaceSlug);
  return { workspaceSlug, reindexedCount };
}
