import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import type { SavedMultipartFile } from "@fastify/multipart";
import {
  buildEntityExtractionPrompt,
  OllamaProvider,
  type LLMExtractionResult
} from "@knowledgeos/ai";
import { ingestMarkdown, type IngestionResult } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import {
  ensureWorkspaceStorage,
  getWorkspaceStoragePaths,
  writeWorkspaceMetadata
} from "./storage.js";
import { rebuildEntityIndex } from "./entities.js";

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

function safeFileName(filename: string) {
  const parsed = path.parse(filename);
  const base = slugify(parsed.name);
  const extension = parsed.ext.toLowerCase();

  return `${base}${extension}`;
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

  await writeFile(markdownPath, markdownBuffer);

  let sourceOriginalPath: string | null = null;

  if (input.originalFile) {
    const originalBuffer = await readFile(input.originalFile.filepath);
    sourceOriginalPath = path.join(paths.originals, safeFileName(input.originalFile.filename));
    await writeFile(sourceOriginalPath, originalBuffer);
  }

  const title = input.title?.trim() || path.parse(input.markdownFile.filename).name;
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

  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await writeWorkspaceMetadata(paths, {
    slug: workspaceSlug,
    storagePath: paths.root,
    updatedAt: new Date().toISOString()
  });

  return metadata;
}

export async function reindexStoredDocument(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    documentName: string;
    useLlm?: boolean;
  }
): Promise<IndexedDocumentMetadata> {
  const workspaceSlug = slugify(input.workspaceSlug);
  const documentName = slugify(input.documentName);
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  const metadataPath = path.join(paths.metadata, `${documentName}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as UploadedDocument;
  const markdown = await readFile(metadata.markdownPath, "utf8");
  const ingestion = ingestMarkdown(markdown);
  const indexedMetadata: IndexedDocumentMetadata = {
    ...metadata,
    status: "INDEXED",
    indexedAt: new Date().toISOString(),
    ingestion
  };

  if (input.useLlm) {
    try {
      const provider = new OllamaProvider(config.ollamaBaseUrl, config.ollamaLlmModel);
      const llmExtraction = await provider.generateJson<LLMExtractionResult>(
        buildEntityExtractionPrompt(ingestion.content)
      );
      indexedMetadata.llmExtraction = llmExtraction;
      indexedMetadata.summary = llmExtraction.summary;
    } catch (error) {
      indexedMetadata.llmExtractionError =
        error instanceof Error ? error.message : "Unknown LLM extraction error.";
    }
  }

  await writeFile(metadataPath, `${JSON.stringify(indexedMetadata, null, 2)}\n`, "utf8");
  await rebuildEntityIndex(config, workspaceSlug);

  return indexedMetadata;
}
