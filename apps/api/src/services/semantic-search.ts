import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { ensureWorkspaceStorage, getWorkspaceStoragePaths } from "./storage.js";
import { writeFileAtomically } from "./storage.js";
import type { IndexedDocumentMetadata } from "./documents.js";
import { getEmbeddingProvider, selectedEmbeddingModel } from "./ai-providers.js";
import { getWorkspaceIngestionSettings } from "./workspace-settings.js";

export type SemanticIndexChunk = {
  id: string;
  workspaceSlug: string;
  documentName: string;
  title: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  embedding: number[];
};

export type SemanticIndex = {
  version: 1;
  workspaceSlug: string;
  embeddingModel: string;
  updatedAt: string;
  chunks: SemanticIndexChunk[];
};

export type SemanticSearchResult = {
  queryType: "SEMANTIC_SEARCH";
  query: string;
  embeddingModel: string;
  results: Array<{
    documentName: string;
    title: string;
    chunkIndex: number;
    heading: string | null;
    score: number;
    snippet: string;
  }>;
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    score: number;
  }>;
};

export type SemanticContextChunk = {
  documentName: string;
  title: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
};

export type EmbeddingCoverageItem = {
  documentName: string;
  title: string;
  chunkCount: number;
  embeddedChunkCount: number;
  status: "MISSING" | "READY";
};

async function readStoredSemanticIndex(config: ApiConfig, workspaceSlug: string): Promise<SemanticIndex | null> {
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  try {
    const index = JSON.parse(await readFile(path.join(paths.metadata, "embeddings.json"), "utf8")) as SemanticIndex;
    return index.embeddingModel === selectedEmbeddingModel(config) ? index : null;
  } catch { return null; }
}

export async function getEmbeddingCoverage(config: ApiConfig, workspaceSlugInput: string): Promise<EmbeddingCoverageItem[]> {
  const workspaceSlug = slugify(workspaceSlugInput);
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const index = await readStoredSemanticIndex(config, workspaceSlug);
  const embeddedByDocument = new Map<string, number>();
  for (const chunk of index?.chunks ?? []) embeddedByDocument.set(chunk.documentName, (embeddedByDocument.get(chunk.documentName) ?? 0) + 1);
  const files = await readdir(paths.metadata);
  const coverage: EmbeddingCoverageItem[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".json") || ["workspace.json", "entities.json", "embeddings.json", "operations.json"].includes(fileName)) continue;
    const metadata = JSON.parse(await readFile(path.join(paths.metadata, fileName), "utf8")) as Partial<IndexedDocumentMetadata>;
    if (metadata.status !== "INDEXED" || !metadata.ingestion) continue;
    const documentName = path.parse(fileName).name;
    const chunkCount = metadata.ingestion.chunks.length;
    const embeddedChunkCount = embeddedByDocument.get(documentName) ?? 0;
    coverage.push({ documentName, title: metadata.title ?? documentName, chunkCount, embeddedChunkCount, status: embeddedChunkCount === chunkCount && chunkCount > 0 ? "READY" : "MISSING" });
  }
  return coverage.sort((left, right) => left.documentName.localeCompare(right.documentName, "tr"));
}

export async function embedSelectedDocuments(
  config: ApiConfig,
  workspaceSlugInput: string,
  documentNames: string[],
  onProgress?: (progress: { completed: number; total: number; documentName: string }) => void,
  signal?: AbortSignal
) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const provider = getEmbeddingProvider(config);
  const existing = await readStoredSemanticIndex(config, workspaceSlug);
  const selected = new Set(documentNames.map(slugify));
  const chunks = (existing?.chunks ?? []).filter((chunk) => !selected.has(chunk.documentName));
  const files = await readdir(paths.metadata);
  const selectedFiles = files.filter((fileName) => selected.has(path.parse(fileName).name));
  let completed = 0;
  for (const fileName of selectedFiles) {
    if (signal?.aborted) throw new Error("Embedding cancelled.");
    const metadata = JSON.parse(await readFile(path.join(paths.metadata, fileName), "utf8")) as Partial<IndexedDocumentMetadata>;
    const documentName = path.parse(fileName).name;
    onProgress?.({ completed, total: selectedFiles.length, documentName });
    if (metadata.status === "INDEXED" && metadata.ingestion) {
      for (const chunk of metadata.ingestion.chunks) {
        if (signal?.aborted) throw new Error("Embedding cancelled.");
        chunks.push({ id: `${documentName}:${chunk.chunkIndex}`, workspaceSlug, documentName, title: metadata.title ?? documentName, chunkIndex: chunk.chunkIndex, heading: chunk.heading, content: chunk.content, embedding: await provider.embed(chunk.content) });
      }
    }
    completed += 1;
    onProgress?.({ completed, total: selectedFiles.length, documentName });
  }
  await writeSemanticIndex(config, { version: 1, workspaceSlug, embeddingModel: selectedEmbeddingModel(config), updatedAt: new Date().toISOString(), chunks });
  return { workspaceSlug, embeddedDocumentCount: completed };
}

export async function rebuildSemanticIndex(
  config: ApiConfig,
  workspaceSlugInput: string
) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const metadataFiles = await readdir(paths.metadata);
  const provider = getEmbeddingProvider(config);
  const chunks: SemanticIndexChunk[] = [];

  for (const fileName of metadataFiles) {
    if (!fileName.endsWith(".json") || fileName === "workspace.json" || fileName === "entities.json" || fileName === "embeddings.json") {
      continue;
    }

    const filePath = path.join(paths.metadata, fileName);
    const metadata = JSON.parse(await readFile(filePath, "utf8")) as Partial<IndexedDocumentMetadata>;

    if (metadata.status !== "INDEXED" || !metadata.ingestion) {
      continue;
    }

    const documentName = path.parse(fileName).name;

    for (const chunk of metadata.ingestion.chunks) {
      const embedding = await provider.embed(chunk.content);
      chunks.push({
        id: `${documentName}:${chunk.chunkIndex}`,
        workspaceSlug,
        documentName,
        title: metadata.title ?? documentName,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        content: chunk.content,
        embedding
      });
    }
  }

  const index: SemanticIndex = {
    version: 1,
    workspaceSlug,
    embeddingModel: selectedEmbeddingModel(config),
    updatedAt: new Date().toISOString(),
    chunks
  };

  await writeSemanticIndex(config, index);
  return index;
}

export async function searchSemanticDocuments(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    query: string;
    limit?: number;
  }
): Promise<SemanticSearchResult> {
  const workspaceSlug = slugify(input.workspaceSlug);
  const settings = await getWorkspaceIngestionSettings(config, workspaceSlug);
  let index = await readSemanticIndex(config, workspaceSlug);
  const provider = getEmbeddingProvider(config);
  const queryEmbedding = await provider.embed(input.query);

  if (index.chunks.some((chunk) => chunk.embedding.length !== queryEmbedding.length)) {
    index = await rebuildSemanticIndex(config, workspaceSlug);
  }

  const results = index.chunks
    .map((chunk) => ({
      documentName: chunk.documentName,
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.heading,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
      snippet: chunk.content.slice(0, 500)
    }))
    .sort((left, right) => right.score - left.score)
    .filter((result) => result.score >= settings.similarityThreshold)
    .slice(0, input.limit ?? settings.semanticTopK);

  return {
    queryType: "SEMANTIC_SEARCH",
    query: input.query,
    embeddingModel: index.embeddingModel,
    results,
    sources: results.map((result) => ({
      documentName: result.documentName,
      title: result.title,
      evidenceSnippet: result.snippet,
      score: result.score
    }))
  };
}

export async function getSemanticContext(
  config: ApiConfig,
  workspaceSlugInput: string,
  results: SemanticSearchResult["results"]
): Promise<SemanticContextChunk[]> {
  const index = await readSemanticIndex(config, slugify(workspaceSlugInput));
  const chunksById = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));

  return results.flatMap((result) => {
    const chunk = chunksById.get(`${result.documentName}:${result.chunkIndex}`);
    return chunk ? [{
      documentName: chunk.documentName,
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.heading,
      content: chunk.content
    }] : [];
  });
}

async function readSemanticIndex(config: ApiConfig, workspaceSlug: string) {
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  const indexPath = path.join(paths.metadata, "embeddings.json");

  try {
    const index = JSON.parse(await readFile(indexPath, "utf8")) as SemanticIndex;

    if (index.embeddingModel === selectedEmbeddingModel(config)) {
      return index;
    }
  } catch {
    // Build the index on first semantic query.
  }

  return rebuildSemanticIndex(config, workspaceSlug);
}

async function writeSemanticIndex(config: ApiConfig, index: SemanticIndex) {
  const paths = await ensureWorkspaceStorage(config.storageRoot, index.workspaceSlug);
  const indexPath = path.join(paths.metadata, "embeddings.json");
  await writeFileAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

export async function invalidateSemanticIndex(config: ApiConfig, workspaceSlugInput: string) {
  const paths = getWorkspaceStoragePaths(config.storageRoot, slugify(workspaceSlugInput));
  try {
    await unlink(path.join(paths.metadata, "embeddings.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
