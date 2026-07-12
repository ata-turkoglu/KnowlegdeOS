import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import {
  ensureWorkspaceStorage,
  getWorkspaceStoragePaths,
  readWorkspaceMetadata
} from "./storage.js";

const transferableDirectories = ["originals", "markdown", "metadata"] as const;

export type WorkspaceTransferFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type WorkspaceTransferBundle = {
  version: 1;
  kind: "WORKSPACE_EXPORT";
  exportedAt: string;
  workspace: {
    slug: string;
    metadata: Record<string, unknown> | null;
  };
  manifest: {
    fileCount: number;
    totalBytes: number;
    files: WorkspaceTransferFile[];
  };
  files: Record<string, string>;
};

export type WorkspaceBundleResult = {
  workspaceSlug: string;
  fileName: string;
  bundlePath: string;
  manifest: WorkspaceTransferBundle["manifest"];
};

function timestampForFileName(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function toBundlePath(relativePath: string) {
  return relativePath.split(path.sep).join("/");
}

function assertSafeBundlePath(filePath: string) {
  const normalized = path.normalize(filePath);

  if (
    path.isAbsolute(filePath) ||
    normalized.startsWith("..") ||
    normalized.includes(`..${path.sep}`)
  ) {
    throw new HttpError(400, `Unsafe bundle path: ${filePath}`);
  }

  return normalized;
}

async function collectFiles(root: string, directory: string) {
  const directoryRoot = path.join(root, directory);
  const entries = await readdir(directoryRoot, {
    recursive: true,
    withFileTypes: true
  });
  const files: Array<{ absolutePath: string; bundlePath: string }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const parentPath = "parentPath" in entry ? entry.parentPath : directoryRoot;
    const absolutePath = path.join(parentPath, entry.name);
    const relativePath = path.relative(root, absolutePath);

    files.push({
      absolutePath,
      bundlePath: toBundlePath(relativePath)
    });
  }

  return files.sort((left, right) => left.bundlePath.localeCompare(right.bundlePath));
}

async function buildWorkspaceBundle(
  config: ApiConfig,
  workspaceSlugInput: string
): Promise<WorkspaceTransferBundle> {
  const workspaceSlug = slugify(workspaceSlugInput);

  if (!workspaceSlug) {
    throw new HttpError(400, "Workspace slug is required.");
  }

  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const collected = (
    await Promise.all(
      transferableDirectories.map((directory) => collectFiles(paths.root, directory))
    )
  ).flat();
  const files: Record<string, string> = {};
  const manifestFiles: WorkspaceTransferFile[] = [];
  let totalBytes = 0;

  for (const file of collected) {
    const buffer = await readFile(file.absolutePath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    files[file.bundlePath] = buffer.toString("base64");
    manifestFiles.push({
      path: file.bundlePath,
      bytes: buffer.byteLength,
      sha256
    });
    totalBytes += buffer.byteLength;
  }

  let metadata: Record<string, unknown> | null = null;

  try {
    metadata = await readWorkspaceMetadata(paths);
  } catch {
    metadata = null;
  }

  return {
    version: 1,
    kind: "WORKSPACE_EXPORT",
    exportedAt: new Date().toISOString(),
    workspace: {
      slug: workspaceSlug,
      metadata
    },
    manifest: {
      fileCount: manifestFiles.length,
      totalBytes,
      files: manifestFiles
    },
    files
  };
}

async function writeBundle(
  config: ApiConfig,
  workspaceSlug: string,
  targetDirectory: "exports" | "backups"
): Promise<WorkspaceBundleResult> {
  const bundle = await buildWorkspaceBundle(config, workspaceSlug);
  const paths = getWorkspaceStoragePaths(config.storageRoot, bundle.workspace.slug);
  const fileName = `${bundle.workspace.slug}-${timestampForFileName()}.knowledgeos-export.json`;
  const bundlePath = path.join(paths[targetDirectory], fileName);

  await mkdir(paths[targetDirectory], { recursive: true });
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  return {
    workspaceSlug: bundle.workspace.slug,
    fileName,
    bundlePath,
    manifest: bundle.manifest
  };
}

export async function createWorkspaceExportBundle(
  config: ApiConfig,
  workspaceSlug: string
) {
  return writeBundle(config, workspaceSlug, "exports");
}

export async function createWorkspaceBackup(config: ApiConfig, workspaceSlug: string) {
  return writeBundle(config, workspaceSlug, "backups");
}

function rewriteImportedMetadata(
  buffer: Buffer,
  bundlePath: string,
  paths: ReturnType<typeof getWorkspaceStoragePaths>,
  workspaceSlug: string,
  targetPath: string
) {
  if (!bundlePath.startsWith("metadata/") || !bundlePath.endsWith(".json")) {
    return buffer;
  }

  try {
    const metadata = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;

    if (bundlePath === "metadata/workspace.json") {
      metadata.slug = workspaceSlug;
      metadata.storagePath = paths.root;
      metadata.importedAt = new Date().toISOString();
    }

    if (typeof metadata.markdownPath === "string") {
      metadata.workspaceSlug = workspaceSlug;
      metadata.markdownPath = path.join(paths.markdown, path.basename(metadata.markdownPath));
      metadata.metadataPath = targetPath;
    }

    if (typeof metadata.sourceOriginalPath === "string") {
      metadata.sourceOriginalPath = path.join(
        paths.originals,
        path.basename(metadata.sourceOriginalPath)
      );
    }

    return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  } catch {
    return buffer;
  }
}

export async function importWorkspaceBundle(
  config: ApiConfig,
  input: {
    targetSlug?: string;
    bundle: WorkspaceTransferBundle;
  }
) {
  if (input.bundle.version !== 1 || input.bundle.kind !== "WORKSPACE_EXPORT") {
    throw new HttpError(400, "Unsupported workspace export bundle.");
  }

  const workspaceSlug = slugify(input.targetSlug || input.bundle.workspace.slug);

  if (!workspaceSlug) {
    throw new HttpError(400, "Target workspace slug is required.");
  }

  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  let restoredFiles = 0;

  for (const manifestFile of input.bundle.manifest.files) {
    const safePath = assertSafeBundlePath(manifestFile.path);
    const encoded = input.bundle.files[manifestFile.path];

    if (!encoded) {
      throw new HttpError(400, `Bundle is missing file content: ${manifestFile.path}`);
    }

    const buffer = Buffer.from(encoded, "base64");
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    if (buffer.byteLength !== manifestFile.bytes || sha256 !== manifestFile.sha256) {
      throw new HttpError(400, `Bundle checksum mismatch: ${manifestFile.path}`);
    }

    const targetPath = path.join(paths.root, safePath);
    const restoredBuffer = rewriteImportedMetadata(
      buffer,
      manifestFile.path,
      paths,
      workspaceSlug,
      targetPath
    );

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, restoredBuffer);
    restoredFiles += 1;
  }

  return {
    imported: true,
    workspaceSlug,
    restoredFiles,
    storagePath: paths.root
  };
}
