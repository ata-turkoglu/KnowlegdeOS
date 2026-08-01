import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiConfig } from "../config/env.js";
import type { IndexingPlan, IndexingStageResult } from './indexing-plan.js';
import { ensureWorkspaceStorage, getWorkspaceStoragePaths, resolveStorageRoot, writeFileAtomically } from "./storage.js";

export type OperationKind = "upload" | "index" | "reindex" | "embedding" | "yaml";
export type OperationStatus = "running" | "completed" | "partial" | "completed_with_warnings" | "failed" | "cancelled" | "interrupted";
export type DocumentIndexingRecord = {
  indexingPlan?: IndexingPlan;
  stageResults?: Record<string, IndexingStageResult>;
  traceId?: string;
};
export type StoredOperation = {
  id: string; workspaceSlug: string; kind: OperationKind; targetName: string;
  status: OperationStatus; stage: string; progress: number; error?: string;
  documentNames?: string[];
  /** Legacy useLlm is read-only compatibility for history written before plan v1. */
  retry?: { documentName?: string; useLlm?: boolean; mode?: 'automatic' | 'user_configured' }; indexingPlan?: IndexingPlan; stageResults?: Record<string, IndexingStageResult>; traceId?: string;
  /** Per-document execution records are required for batch auditability. */
  documentIndexing?: Record<string, DocumentIndexingRecord>;
  createdAt: string; updatedAt: string; completedAt?: string;
};

const fileName = "operations.json";
const terminal = new Set<OperationStatus>(["completed", "completed_with_warnings", "partial", "failed", "cancelled", "interrupted"]);
const retentionMs = 7 * 24 * 60 * 60 * 1000;
const controllers = new Map<string, AbortController>();

async function readOperations(config: ApiConfig, workspaceSlug: string) {
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  try {
    const operations = JSON.parse(await readFile(path.join(paths.metadata, fileName), "utf8")) as StoredOperation[];
    const now = Date.now();
    const pruned = operations.filter((item) => !terminal.has(item.status) || now - Date.parse(item.updatedAt) <= retentionMs);
    if (pruned.length !== operations.length) await writeFileAtomically(path.join(paths.metadata, fileName), `${JSON.stringify(pruned, null, 2)}\n`);
    return pruned;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function save(config: ApiConfig, workspaceSlug: string, operations: StoredOperation[]) {
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  await writeFileAtomically(path.join(paths.metadata, fileName), `${JSON.stringify(operations, null, 2)}\n`);
}
export async function listOperations(config: ApiConfig, workspaceSlug: string) {
  return (await readOperations(config, workspaceSlug)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function clearOperationHistory(config: ApiConfig, workspaceSlug: string) {
  const operations = await readOperations(config, workspaceSlug);
  const active = operations.filter((item) => item.status === "running");
  const removed = operations.length - active.length;
  if (removed > 0) await save(config, workspaceSlug, active);
  return { removed };
}
export async function findRunningOperation(config: ApiConfig, workspaceSlug: string) {
  return (await readOperations(config, workspaceSlug)).find((item) => item.status === "running") ?? null;
}
export async function createOperation(config: ApiConfig, input: Omit<StoredOperation, "id" | "createdAt" | "updatedAt">) {
  const operations = await readOperations(config, input.workspaceSlug); const now = new Date().toISOString();
  const operation: StoredOperation = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  operations.push(operation); await save(config, input.workspaceSlug, operations); return operation;
}
export async function updateOperation(config: ApiConfig, workspaceSlug: string, id: string, update: Partial<Omit<StoredOperation, "id" | "workspaceSlug" | "createdAt">>) {
  const operations = await readOperations(config, workspaceSlug); const index = operations.findIndex((item) => item.id === id);
  if (index < 0) return null; const status = update.status ?? operations[index].status;
  operations[index] = { ...operations[index], ...update, updatedAt: new Date().toISOString(), completedAt: terminal.has(status) ? new Date().toISOString() : operations[index].completedAt };
  await save(config, workspaceSlug, operations); return operations[index];
}
export function trackOperationController(id: string, controller: AbortController) { controllers.set(id, controller); }
export function releaseOperationController(id: string) { controllers.delete(id); }
export function cancelTrackedOperation(id: string) {
  const controller = controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
export async function interruptRunningOperations(config: ApiConfig, workspaceSlug: string) {
  const operations = await readOperations(config, workspaceSlug); let changed = false;
  for (const item of operations) if (item.status === "running") { item.status = "interrupted"; item.stage = "Server restarted"; item.error = "The server restarted before this operation finished."; item.updatedAt = new Date().toISOString(); item.completedAt = item.updatedAt; changed = true; }
  if (changed) await save(config, workspaceSlug, operations);
}
export async function interruptAllRunningOperations(config: ApiConfig) {
  const root = path.join(resolveStorageRoot(config.storageRoot), "workspaces");
  try {
    const workspaces = await readdir(root, { withFileTypes: true });
    await Promise.all(workspaces.filter((entry) => entry.isDirectory()).map((entry) => interruptRunningOperations(config, entry.name)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
