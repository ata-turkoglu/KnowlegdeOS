import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OllamaEmbeddingProvider } from "@knowledgeos/ai";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { ensureWorkspaceStorage, getWorkspaceStoragePaths } from "./storage.js";
import type { IndexedDocumentMetadata } from "./documents.js";

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

export async function rebuildSemanticIndex(
  config: ApiConfig,
  workspaceSlugInput: string
) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const metadataFiles = await readdir(paths.metadata);
  const provider = new OllamaEmbeddingProvider(
    config.ollamaBaseUrl,
    config.ollamaEmbeddingModel
  );
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
    embeddingModel: config.ollamaEmbeddingModel,
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
  const index = await readSemanticIndex(config, workspaceSlug);
  const provider = new OllamaEmbeddingProvider(
    config.ollamaBaseUrl,
    config.ollamaEmbeddingModel
  );
  const queryEmbedding = await provider.embed(input.query);
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
    .slice(0, input.limit ?? 5);

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

async function readSemanticIndex(config: ApiConfig, workspaceSlug: string) {
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  const indexPath = path.join(paths.metadata, "embeddings.json");

  try {
    const index = JSON.parse(await readFile(indexPath, "utf8")) as SemanticIndex;

    if (index.embeddingModel === config.ollamaEmbeddingModel) {
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
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
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
