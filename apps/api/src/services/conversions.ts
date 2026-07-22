import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SavedMultipartFile } from "@fastify/multipart";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import { resolveStorageRoot, writeFileAtomically } from "./storage.js";

const wordExtensions = new Set([".docx"]);

export type ConvertedFile = {
  filename: string;
  title: string;
  sourceOriginal: string;
  size: number;
  convertedAt: string;
};

export type SplitConversionResult = {
  sourceFilename: string;
  files: ConvertedFile[];
};

function resolveConversionWorkspace(config: ApiConfig, workspaceSlugInput: string) {
  // Keep converted files alongside the project's storage root even when the
  // API is started from apps/api (as pnpm --filter does in development).
  const root = resolveStorageRoot(config.conversionRoot);
  const workspaceSlug = slugify(workspaceSlugInput || "inbox");
  return { root, workspaceSlug, directory: path.join(root, workspaceSlug) };
}

function safeOutputName(filename: string) {
  if (!/^[a-z0-9]+(?:-+[a-z0-9]+)*\.md$/.test(filename)) return "";
  return filename;
}

async function runPandoc(sourcePath: string, outputPath: string, mediaPath: string) {
  await new Promise<void>((resolve, reject) => {
    const process = spawn("pandoc", [
      sourcePath,
      "--from=docx",
      "--to=gfm+pipe_tables",
      "--wrap=none",
      `--extract-media=${mediaPath}`,
      "--output",
      outputPath
    ]);
    let errorOutput = "";
    process.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    process.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new HttpError(503, "Pandoc is not installed on the API server."));
        return;
      }
      reject(error);
    });
    process.once("close", (code) => {
      if (code === 0) return resolve();
      reject(new HttpError(422, errorOutput.trim() || "Pandoc could not convert this Word file."));
    });
  });
}

export async function convertWordDocument(
  config: ApiConfig,
  input: { workspaceSlug?: string; wordFile: SavedMultipartFile }
): Promise<ConvertedFile> {
  const extension = path.extname(input.wordFile.filename).toLowerCase();
  if (!wordExtensions.has(extension)) throw new HttpError(400, "Only .docx files can be converted.");

  const { directory } = resolveConversionWorkspace(config, input.workspaceSlug ?? "inbox");
  const sourceDirectory = path.join(directory, "_sources");
  const assetsDirectory = path.join(directory, "assets");
  await Promise.all([mkdir(sourceDirectory, { recursive: true }), mkdir(assetsDirectory, { recursive: true })]);

  const sourceHash = createHash("sha256").update(await readFile(input.wordFile.filepath)).digest("hex").slice(0, 8);
  const baseName = slugify(path.parse(input.wordFile.filename).name);
  const fileStem = `${baseName}-${sourceHash}`;
  const sourceName = `${fileStem}.docx`;
  const markdownName = `${fileStem}.md`;
  const sourcePath = path.join(sourceDirectory, sourceName);
  const markdownPath = path.join(directory, markdownName);
  const temporaryMarkdownPath = path.join(directory, `.${markdownName}.tmp`);
  const mediaPath = path.join(assetsDirectory, fileStem);

  await copyFile(input.wordFile.filepath, sourcePath);
  await rm(mediaPath, { recursive: true, force: true });

  try {
    await runPandoc(sourcePath, temporaryMarkdownPath, mediaPath);
    const body = await readFile(temporaryMarkdownPath, "utf8");
    await writeFileAtomically(markdownPath, `${body.trim()}\n`);
  } finally {
    await rm(temporaryMarkdownPath, { force: true });
  }

  const fileStat = await stat(markdownPath);
  return {
    filename: markdownName,
    title: path.parse(input.wordFile.filename).name,
    sourceOriginal: input.wordFile.filename,
    size: fileStat.size,
    convertedAt: fileStat.mtime.toISOString()
  };
}

export async function listConvertedFiles(config: ApiConfig, workspaceSlugInput: string): Promise<ConvertedFile[]> {
  const { directory } = resolveConversionWorkspace(config, workspaceSlugInput);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    const fileStat = await stat(filePath);
    return {
      filename: entry.name,
      title: path.parse(entry.name).name,
      sourceOriginal: "",
      size: fileStat.size,
      convertedAt: fileStat.mtime.toISOString()
    };
  }));
  return files.sort((left, right) => right.convertedAt.localeCompare(left.convertedAt));
}

export async function getConvertedFile(config: ApiConfig, workspaceSlugInput: string, filename: string) {
  const { directory } = resolveConversionWorkspace(config, workspaceSlugInput);
  const safeName = safeOutputName(filename);
  if (safeName !== filename) throw new HttpError(400, "Invalid converted file name.");
  return readFile(path.join(directory, safeName), "utf8");
}

export async function deleteConvertedFile(config: ApiConfig, workspaceSlugInput: string, filename: string) {
  const { directory } = resolveConversionWorkspace(config, workspaceSlugInput);
  const safeName = safeOutputName(filename);
  if (safeName !== filename) throw new HttpError(400, "Invalid converted file name.");
  const stem = path.parse(safeName).name;
  await Promise.all([
    rm(path.join(directory, safeName), { force: true }),
    rm(path.join(directory, "assets", stem), { recursive: true, force: true })
  ]);
}

/** Splits a Pandoc Markdown file at each level-two heading. */
export async function splitConvertedFile(
  config: ApiConfig,
  workspaceSlugInput: string,
  filename: string
): Promise<SplitConversionResult> {
  const { directory } = resolveConversionWorkspace(config, workspaceSlugInput);
  const safeName = safeOutputName(filename);
  if (safeName !== filename) throw new HttpError(400, "Invalid converted file name.");

  const source = await readFile(path.join(directory, safeName), "utf8");
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const starts = lines.reduce<number[]>((indices, line, index) => {
    if (/^##\s+\S/.test(line)) indices.push(index);
    return indices;
  }, []);
  if (starts.length === 0) {
    throw new HttpError(422, "This Markdown file has no level-two (##) headings to split.");
  }

  const sourceStem = path.parse(safeName).name;
  const created: ConvertedFile[] = [];
  const filenameCounts = new Map<string, number>();
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = starts[index + 1] ?? lines.length;
    const heading = lines[start]!.replace(/^##\s+/, "").trim();
    const code = slugify(heading);
    const count = (filenameCounts.get(code) ?? 0) + 1;
    filenameCounts.set(code, count);
    const partName = `${sourceStem}--${code}${count > 1 ? `-${count}` : ""}.md`;
    const partPath = path.join(directory, partName);
    await writeFileAtomically(partPath, `${lines.slice(start, end).join("\n").trim()}\n`);
    const fileStat = await stat(partPath);
    created.push({
      filename: partName,
      title: heading,
      sourceOriginal: safeName,
      size: fileStat.size,
      convertedAt: fileStat.mtime.toISOString()
    });
  }

  return { sourceFilename: safeName, files: created };
}
