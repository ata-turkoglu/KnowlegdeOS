import { readWorkspaceMetadata, ensureWorkspaceStorage, writeWorkspaceMetadata } from "./storage.js";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { ragRetrievalCache } from "./rag-cache.js";

export type WorkspaceIngestionSettings = {
  chunkSize: number;
  chunkOverlap: number;
  semanticTopK: number;
  similarityThreshold: number;
};

export const defaultIngestionSettings: WorkspaceIngestionSettings = {
  chunkSize: 450,
  chunkOverlap: 60,
  semanticTopK: 5,
  similarityThreshold: 0.25
};

function sanitize(value: Partial<WorkspaceIngestionSettings>): WorkspaceIngestionSettings {
  const chunkSize = boundedInteger(value.chunkSize, defaultIngestionSettings.chunkSize, 100, 2_000);
  return {
    chunkSize,
    chunkOverlap: boundedInteger(value.chunkOverlap, defaultIngestionSettings.chunkOverlap, 0, chunkSize - 1),
    semanticTopK: boundedInteger(value.semanticTopK, defaultIngestionSettings.semanticTopK, 1, 20),
    similarityThreshold: boundedNumber(value.similarityThreshold, defaultIngestionSettings.similarityThreshold, 0, 1)
  };
}

export async function getWorkspaceIngestionSettings(config: ApiConfig, workspaceSlugInput: string) {
  const workspaceSlug = slugify(workspaceSlugInput || "merter-arsivi");
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  try {
    const metadata = await readWorkspaceMetadata(paths);
    return sanitize((metadata.ingestionSettings ?? {}) as Partial<WorkspaceIngestionSettings>);
  } catch {
    return defaultIngestionSettings;
  }
}

export async function saveWorkspaceIngestionSettings(config: ApiConfig, workspaceSlugInput: string, value: Partial<WorkspaceIngestionSettings>) {
  const workspaceSlug = slugify(workspaceSlugInput || "merter-arsivi");
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  let metadata: Record<string, unknown> = {};
  try { metadata = await readWorkspaceMetadata(paths); } catch { /* Workspace metadata is created on first save. */ }
  const ingestionSettings = sanitize(value);
  await writeWorkspaceMetadata(paths, { ...metadata, slug: workspaceSlug, storagePath: paths.root, updatedAt: new Date().toISOString(), ingestionSettings });
  ragRetrievalCache.invalidateWorkspace(workspaceSlug);
  return ingestionSettings;
}

export function matchesIngestionSettings(
  value: Partial<WorkspaceIngestionSettings> | undefined,
  expected: WorkspaceIngestionSettings
) {
  if (!value) return false;
  const normalized = sanitize(value);
  return normalized.chunkSize === expected.chunkSize
    && normalized.chunkOverlap === expected.chunkOverlap
    && normalized.semanticTopK === expected.semanticTopK
    && normalized.similarityThreshold === expected.similarityThreshold;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}
