import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import {
  ensureStorageRoot,
  ensureWorkspaceStorage,
  getWorkspaceStoragePaths
} from "./storage.js";
import type { IndexedDocumentMetadata } from "./documents.js";
import type { EntityIndex } from "./entities.js";

const ignoredMetadataFiles = new Set([
  "workspace.json",
  "entities.json",
  "embeddings.json"
]);

export type DashboardSummary = {
  workspaceSlug: string;
  workspaceCount: number;
  documentCount: number;
  indexedDocumentCount: number;
  entityCount: number;
  chunkCount: number;
  embeddingCount: number;
};

async function listJsonFiles(directory: string) {
  try {
    const files = await readdir(directory);
    return files.filter((fileName) => fileName.endsWith(".json"));
  } catch {
    return [];
  }
}

async function countWorkspaces(config: ApiConfig) {
  const storageRoot = await ensureStorageRoot(config.storageRoot);
  const workspaceRoot = path.join(storageRoot, "workspaces");

  try {
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

export async function getDashboardSummary(
  config: ApiConfig,
  workspaceSlugInput: string
): Promise<DashboardSummary> {
  const workspaceSlug = slugify(workspaceSlugInput || "merter-arsivi");
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const metadataFiles = await listJsonFiles(paths.metadata);
  let documentCount = 0;
  let indexedDocumentCount = 0;
  let chunkCount = 0;

  for (const fileName of metadataFiles) {
    if (ignoredMetadataFiles.has(fileName)) {
      continue;
    }

    documentCount += 1;

    try {
      const metadata = JSON.parse(
        await readFile(path.join(paths.metadata, fileName), "utf8")
      ) as Partial<IndexedDocumentMetadata>;

      if (metadata.status === "INDEXED") {
        indexedDocumentCount += 1;
        chunkCount += metadata.ingestion?.chunks.length ?? 0;
      }
    } catch {
      // Corrupt document metadata should not break the dashboard summary.
    }
  }

  let entityCount = 0;
  let embeddingCount = 0;

  try {
    const index = JSON.parse(
      await readFile(path.join(paths.metadata, "entities.json"), "utf8")
    ) as Partial<EntityIndex>;
    entityCount = index.entities?.length ?? 0;
  } catch {
    entityCount = 0;
  }

  try {
    const embeddings = JSON.parse(
      await readFile(path.join(paths.metadata, "embeddings.json"), "utf8")
    ) as { chunks?: unknown[] };
    embeddingCount = embeddings.chunks?.length ?? 0;
  } catch {
    embeddingCount = 0;
  }

  return {
    workspaceSlug,
    workspaceCount: await countWorkspaces(config),
    documentCount,
    indexedDocumentCount,
    entityCount,
    chunkCount,
    embeddingCount
  };
}
