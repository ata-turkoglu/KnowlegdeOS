import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type WorkspaceStoragePaths = {
  root: string;
  originals: string;
  markdown: string;
  metadata: string;
  exports: string;
  backups: string;
};

export function resolveStorageRoot(storageRoot: string) {
  if (path.isAbsolute(storageRoot)) {
    return storageRoot;
  }

  const workspaceRoot = process.env.INIT_CWD ?? path.resolve(process.cwd(), "../..");

  return path.resolve(workspaceRoot, storageRoot);
}

export function getWorkspaceStoragePaths(
  storageRoot: string,
  workspaceSlug: string
): WorkspaceStoragePaths {
  const root = path.join(resolveStorageRoot(storageRoot), "workspaces", workspaceSlug);

  return {
    root,
    originals: path.join(root, "originals"),
    markdown: path.join(root, "markdown"),
    metadata: path.join(root, "metadata"),
    exports: path.join(root, "exports"),
    backups: path.join(root, "backups")
  };
}

export async function ensureStorageRoot(storageRoot: string) {
  const root = resolveStorageRoot(storageRoot);
  await mkdir(path.join(root, "workspaces"), { recursive: true });

  return root;
}

export async function ensureWorkspaceStorage(
  storageRoot: string,
  workspaceSlug: string
) {
  const paths = getWorkspaceStoragePaths(storageRoot, workspaceSlug);
  await Promise.all([
    mkdir(paths.originals, { recursive: true }),
    mkdir(paths.markdown, { recursive: true }),
    mkdir(paths.metadata, { recursive: true }),
    mkdir(paths.exports, { recursive: true }),
    mkdir(paths.backups, { recursive: true })
  ]);

  return paths;
}

export async function writeWorkspaceMetadata(
  paths: WorkspaceStoragePaths,
  metadata: Record<string, unknown>
) {
  const filePath = path.join(paths.metadata, "workspace.json");
  await writeFileAtomically(filePath, `${JSON.stringify(metadata, null, 2)}\n`);

  return filePath;
}

export async function writeFileAtomically(filePath: string, content: string | Uint8Array) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try { await unlink(temporaryPath); } catch { /* Nothing to clean up. */ }
    throw error;
  }
}

export async function readWorkspaceMetadata(paths: WorkspaceStoragePaths) {
  const filePath = path.join(paths.metadata, "workspace.json");
  const content = await readFile(filePath, "utf8");

  return JSON.parse(content) as Record<string, unknown>;
}
