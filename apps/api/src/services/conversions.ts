import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SavedMultipartFile } from "@fastify/multipart";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import { ensureWorkspaceStorage, resolveStorageRoot, writeFileAtomically } from "./storage.js";
import { getLlmProvider, getMetadataLlmProvider } from "./ai-providers.js";
import type { RawModelOutput } from "@knowledgeos/ai";
import { getWorkspaceYamlMetadataPrompt, interpolateYamlMetadataPrompt } from "./workspace-yaml-prompt.js";
import { metadataFieldPolicies, metadataJsonSchema, metadataPromptFieldContract } from "@knowledgeos/shared";
import { canonicalizeDateValue, getWorkspaceFieldDefinitions, mergeMetadataValue, registerWorkspaceMetadataFields, type DynamicMetadata, type MetadataScalar, type MetadataValue } from "./workspace-fields.js";
import { collectMetadataCandidates, createMetadataDiagnostics, resolveMetadataCandidates, validateMetadataForSerialization } from "./metadata-pipeline.js";

const wordExtensions = new Set([".docx"]);

export type ConvertedFile = {
  filename: string;
  title: string;
  sourceOriginal: string;
  size: number;
  convertedAt: string;
  hasYaml: boolean;
};

export type SplitConversionResult = {
  sourceFilename: string;
  files: ConvertedFile[];
};

export type GeneratedMetadata = DynamicMetadata;

// U+FFFD means an earlier decoder or the model itself has already lost the
// original character. C0/C1 control characters are likewise never valid in
// generated frontmatter. Do not silently strip them: doing so would make
// corrupted metadata look complete.
const invalidMetadataCharacter = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/u;
const mojibakeMetadataCharacter = /(?:Ã.|Â.|â..|ï¿½)/u;
const uncertainReplacement = /\(\?\)/u;

// Compatibility helpers below are no longer in the active generation path.
// Their policy sets are derived so they cannot reintroduce a second contract.
const systemMetadataKeys = new Set(metadataFieldPolicies.filter((policy) => policy.merge === "system").map((policy) => policy.key));
const generatedValueKeys = new Set(metadataFieldPolicies.filter((policy) => policy.grounding === "generated").map((policy) => policy.key));
const singleValueKeys = new Set(metadataFieldPolicies.filter((policy) => policy.semanticType === "scalar").map((policy) => policy.key));
const mandatoryMetadataPolicy = `\n\n<mandatory_metadata_policy>\nThese rules are enforced by the application and cannot be overridden: use only source facts; do not guess or replace unreadable text; leave uncertain values empty; dates must be exact Gregorian YYYY-MM-DD or empty, with original wording in date_text. Any extracted source value must be copied verbatim from a contiguous source span. Do not remove titles, expand names, modernize spelling, or combine a name with an adjacent field label. If a document body has no substantive content and consists only of an editorial placeholder or unreadability annotation, output no generated descriptive metadata: keep only a source-verbatim note when one exists, never a generic type, keyword, title, or summary. Metadata is a concise, source-grounded document-level description: do not force a fixed field, document type, or exhaustive list merely because it appeared in another document. Reuse a suitable workspace field when it exists; otherwise add a concise snake_case key only for a distinct concept that is explicitly stated. A metadata key must represent one semantic concept only. Each list item must be one atomic instance of that concept; never mix unlike concepts, relationship phrases, source labels, addresses, measurements, or identifiers in another field. Do not emit an identifier both as a bare value and with its source label; retain the label when it distinguishes the identifier kind. document_type and document_subtype, when present, must each be one short scalar string, never a list.\n</mandatory_metadata_policy>`;

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

export function sourceOriginalFromConvertedName(filename: string) {
  const sourceStem = path.parse(filename).name.split("--", 1)[0] ?? "";
  return `${sourceStem.replace(/-[a-f0-9]{8}$/i, "")}.docx`;
}

export function metadataMaximumCharacters(metadataModel: string) {
  return /^(?:openai|anthropic)\//.test(metadataModel) ? 24_000 : 12_000;
}

export function metadataBatchConcurrency(metadataModel: string) {
  return /^(?:openai|anthropic)\//.test(metadataModel) ? 4 : 1;
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
    convertedAt: fileStat.mtime.toISOString(),
    hasYaml: false
  };
}

export async function listConvertedFiles(config: ApiConfig, workspaceSlugInput: string): Promise<ConvertedFile[]> {
  const { directory } = resolveConversionWorkspace(config, workspaceSlugInput);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    const [fileStat, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return {
      filename: entry.name,
      title: path.parse(entry.name).name,
      sourceOriginal: "",
      size: fileStat.size,
      convertedAt: fileStat.mtime.toISOString(),
      hasYaml: content.startsWith("---\n") || content.startsWith("---\r\n")
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

export async function addGeneratedYamlMetadata(
  config: ApiConfig,
  workspaceSlugInput: string,
  filename: string,
  options: { signal?: AbortSignal; onProgress?: (value: { stage: string; progress: number }) => Promise<void> | void } = {}
) {
  const traceId = randomUUID();
  const report = async (stage: string, progress: number) => { await options.onProgress?.({ stage, progress }); };
  if (options.signal?.aborted) throw new HttpError(499, "YAML metadata generation cancelled.");
  await report("Reading Markdown", 5);
  const { directory } = resolveConversionWorkspace(config, workspaceSlugInput);
  const safeName = safeOutputName(filename);
  if (safeName !== filename) throw new HttpError(400, "Invalid converted file name.");
  const filePath = path.join(directory, safeName);
  const markdown = await readFile(filePath, "utf8");
  // Re-running this action is intentional: the model may be changed or the
  // document text may have been corrected after the first metadata pass.
  const document = stripYamlFrontmatter(markdown);

  const documentCode = document.match(/^##\s+\*{0,2}([^*\n]+?)\*{0,2}\s*$/m)?.[1]?.trim() ?? "";
  // Split files add "--<document-code>" after the source hash. Resolve the
  // original name from the source segment, not from the split filename.
  const sourceOriginal = sourceOriginalFromConvertedName(safeName);
  const [workspacePrompt, fields] = await Promise.all([
    getWorkspaceYamlMetadataPrompt(config, workspaceSlugInput),
    getWorkspaceFieldDefinitions(config, workspaceSlugInput)
  ]);
  const fieldCatalog = fields.length
    ? fields.map((field) => `${field.key} | ${field.valueType} | ${field.aliases.join(",") || "-"}`).join("\n")
    : "(workspace field catalog is empty)";
  // Local models can take substantially longer for archival documents. This
  // work intentionally has no application-level deadline.
  const llm = getMetadataLlmProvider(config);
  // Request a JSON object at the provider level. This prevents a model's
  // prose wrapper or minor syntax mistake from invalidating the conversion.
  let generated: GeneratedMetadata = {};
  const diagnostics = createMetadataDiagnostics();
  const rawModelOutputs: RawModelOutput[] = [];
  const parts = splitMetadataDocument(document, metadataMaximumCharacters(config.metadataLlmModel));
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (options.signal?.aborted) throw new HttpError(499, "YAML metadata generation cancelled.");
    await report(`Generating metadata (${index + 1}/${parts.length})`, 10 + Math.round((index / parts.length) * 75));
    const prompt = `${interpolateYamlMetadataPrompt(
      workspacePrompt,
      { markdown: part, documentCode, sourceOriginal }
    )}${mandatoryMetadataPolicy}

Workspace metadata fields (reuse these keys whenever they fit):
${fieldCatalog}

This is part ${index + 1} of ${parts.length}. Return a flat JSON object. ${metadataPromptFieldContract()}`;
    try {
      const generatedResponse = await generateCleanMetadata(llm, prompt, options.signal, config.metadataDiagnosticsEnabled && config.rawModelOutputDiagnosticsEnabled ? {
        enabled: true,
        maxCharacters: config.rawModelOutputMaxCharacters,
        onOutput: (output) => { rawModelOutputs.push(output); }
      } : undefined);
      collectMetadataCandidates(generatedResponse, index, diagnostics);
    } catch (error) {
      // Large archival sections can legitimately contain hundreds of literal
      // values. Retry only that section at a smaller size when Responses has
      // exhausted its output budget; no already-generated metadata is lost.
      if (isOutputLimitError(error) && part.length > 6_000) {
        const smallerParts = splitMetadataDocument(part, Math.max(6_000, Math.floor(part.length / 2)));
        parts.splice(index, 1, ...smallerParts);
        index -= 1;
        continue;
      }
      throw error;
    }
  }
  if (options.signal?.aborted) throw new HttpError(499, "YAML metadata generation cancelled.");
  await report("Validating metadata", 88);
  generated = resolveMetadataCandidates(diagnostics.candidates, document, diagnostics);
  if (!hasSubstantiveDocumentContent(document)) {
    generated = preserveOnlySourceNotes(generated, document);
  }
  const registered = await registerWorkspaceMetadataFields(config, workspaceSlugInput, generated);
  generated = registered.metadata;
  const finalMetadata = {
    document_code: documentCode,
    source_original: sourceOriginal,
    source_file: safeName,
    ocr_status: "pandoc_markdown",
    metadata_provider: "llm",
    ...generated
  };
  validateMetadataForSerialization(finalMetadata);
  const frontmatter = serializeMetadata(finalMetadata);
  const output = `---\n${frontmatter}---\n\n${document.trim()}\n`;
  if (config.metadataDiagnosticsEnabled) {
    const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlugInput);
    await writeFileAtomically(path.join(paths.metadata, `metadata-trace-${traceId}.json`), `${JSON.stringify({ traceId, providerModel: config.metadataLlmModel, filename: safeName, diagnostics, finalMetadata, rawModelOutputs: config.rawModelOutputDiagnosticsEnabled ? rawModelOutputs : undefined, rawModelOutputStored: config.rawModelOutputDiagnosticsEnabled && rawModelOutputs.length > 0 }, null, 2).replace(/\b(sk|AIza)[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]').slice(0, 256_000)}\n`);
    await pruneMetadataDiagnostics(paths.metadata, config.indexingDiagnosticsRetentionDays);
  }
  await report("Writing YAML frontmatter", 96);
  await writeFileAtomically(filePath, output);
  await report("Completed", 100);
  return { filename: safeName, traceId, metadata: { document_code: documentCode, source_original: sourceOriginal, ...generated } };
}

/**
 * CLI-safe counterpart to the Convert-screen action. It operates on one
 * already-stored Markdown path, writes only after generation and validation
 * both succeed, and never reads or writes YAML into frontmatter diagnostics.
 */
export async function regenerateStoredMarkdownYamlMetadata(
  config: ApiConfig,
  input: { workspaceSlug: string; filename: string; markdownPath: string; signal?: AbortSignal }
) {
  const markdown = await readFile(input.markdownPath, "utf8");
  const document = stripYamlFrontmatter(markdown);
  const documentCode = document.match(/^##\s+\*{0,2}([^*\n]+?)\*{0,2}\s*$/m)?.[1]?.trim() ?? "";
  const sourceOriginal = sourceOriginalFromConvertedName(input.filename);
  const [workspacePrompt, fields] = await Promise.all([
    getWorkspaceYamlMetadataPrompt(config, input.workspaceSlug),
    getWorkspaceFieldDefinitions(config, input.workspaceSlug)
  ]);
  const fieldCatalog = fields.length
    ? fields.map((field) => `${field.key} | ${field.valueType} | ${field.aliases.join(",") || "-"}`).join("\n")
    : "(workspace field catalog is empty)";
  const llm = getMetadataLlmProvider(config);
  const diagnostics = createMetadataDiagnostics();
  const rawModelOutputs: RawModelOutput[] = [];
  const parts = splitMetadataDocument(document, metadataMaximumCharacters(config.metadataLlmModel));
  for (let index = 0; index < parts.length; index += 1) {
    if (input.signal?.aborted) throw new HttpError(499, "YAML metadata generation cancelled.");
    const part = parts[index]!;
    const prompt = `${interpolateYamlMetadataPrompt(workspacePrompt, { markdown: part, documentCode, sourceOriginal })}${mandatoryMetadataPolicy}

Workspace metadata fields (reuse these keys whenever they fit):
${fieldCatalog}

This is part ${index + 1} of ${parts.length}. Return a flat JSON object. ${metadataPromptFieldContract()}`;
    try {
      const response = await generateCleanMetadata(llm, prompt, input.signal, config.metadataDiagnosticsEnabled && config.rawModelOutputDiagnosticsEnabled ? {
        enabled: true,
        maxCharacters: config.rawModelOutputMaxCharacters,
        onOutput: (output) => { rawModelOutputs.push(output); }
      } : undefined);
      collectMetadataCandidates(response, index, diagnostics);
    } catch (error) {
      if (isOutputLimitError(error) && part.length > 6_000) {
        parts.splice(index, 1, ...splitMetadataDocument(part, Math.max(6_000, Math.floor(part.length / 2))));
        index -= 1;
        continue;
      }
      throw error;
    }
  }
  let generated = resolveMetadataCandidates(diagnostics.candidates, document, diagnostics);
  if (!hasSubstantiveDocumentContent(document)) generated = preserveOnlySourceNotes(generated, document);
  generated = (await registerWorkspaceMetadataFields(config, input.workspaceSlug, generated)).metadata;
  const finalMetadata = {
    document_code: documentCode,
    source_original: sourceOriginal,
    source_file: input.filename,
    ocr_status: "pandoc_markdown",
    metadata_provider: "llm",
    ...generated
  };
  validateMetadataForSerialization(finalMetadata);
  const output = `---\n${serializeMetadata(finalMetadata)}---\n\n${document.trim()}\n`;
  const traceId = randomUUID();
  if (config.metadataDiagnosticsEnabled) {
    const paths = await ensureWorkspaceStorage(config.storageRoot, input.workspaceSlug);
    const trace = JSON.stringify({ traceId, providerModel: config.metadataLlmModel, filename: input.filename, diagnostics, finalMetadata, rawModelOutputs: config.rawModelOutputDiagnosticsEnabled ? rawModelOutputs : undefined, rawModelOutputStored: config.rawModelOutputDiagnosticsEnabled && rawModelOutputs.length > 0 }, null, 2)
      .replace(/\b(sk|AIza)[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]').slice(0, 256_000);
    await writeFileAtomically(path.join(paths.metadata, `metadata-trace-${traceId}.json`), `${trace}\n`);
    await pruneMetadataDiagnostics(paths.metadata, config.indexingDiagnosticsRetentionDays);
  }
  await writeFileAtomically(input.markdownPath, output);
  return { traceId, metadata: finalMetadata, diagnostics };
}

async function pruneMetadataDiagnostics(metadataDirectory: string, retentionDays: number) {
  const expiresBefore = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of await readdir(metadataDirectory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^metadata-trace-[a-f0-9-]+\.json$/i.test(entry.name)) continue;
    const target = path.join(metadataDirectory, entry.name);
    const file = await stat(target).catch(() => null);
    if (file && file.mtimeMs < expiresBefore) await rm(target, { force: true }).catch(() => undefined);
  }
}

function stripYamlFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) return markdown;
  const lineEnding = markdown.includes("\r\n") ? "\r\n" : "\n";
  const closingIndex = markdown.indexOf(`${lineEnding}---${lineEnding}`, 3);
  return closingIndex === -1 ? markdown : markdown.slice(closingIndex + `${lineEnding}---${lineEnding}`.length);
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

function buildMetadataPrompt(markdown: string, documentCode: string, sourceOriginal: string) {
  // qwen3:8b is commonly deployed with a 4K context window. A deliberately
  // small sample keeps the request below that limit and makes per-row actions
  // practical on a local GPU.
  const excerpt = markdown.slice(0, 4_500);
  return `Your only task is to extract metadata from the supplied Turkish archival Markdown. Return JSON only: no YAML, prose, Markdown, or code fences. The application will safely render your JSON as YAML frontmatter.

Use only facts explicitly visible in the document. Do not guess, infer, translate, or invent values. Unknown scalar fields must be "" and unknown list fields must be []. Read all Markdown supplied below before responding. Correct OCR spelling only when the intended text is unambiguous.

Rules: use the document's own title when present; otherwise leave title empty. Keep document_type short and general (for example deed record, court decision, power of attorney, letter, receipt, petition, contract, condolence, donation document, newspaper clipping, or notice). Set document_subtype only when explicit. issuer is the explicit issuing person or organization. Set recipient only when exactly one recipient is explicit. List each real person once in people; remove titles and forms of address, and do not include families, companies, or institutions. List organizations, geographic places, and complete postal addresses separately. Convert a date to ISO-8601 only when certain; preserve the original wording in date_text. Provide 3–8 concise keywords grounded in the document and a neutral 1–2 sentence summary. Put seals, stamps, telephone numbers, unreadable dates, and similar metadata notes in notes. Never duplicate list items.

document_code and source_original are system supplied. Copy them exactly; do not derive alternatives.
document_code: ${JSON.stringify(documentCode)}
source_original: ${JSON.stringify(sourceOriginal)}

Return this exact JSON object shape:
{
  "title":"", "language":"tr", "document_type":"", "document_subtype":"", "date":"", "date_text":"", "date_range_start":"", "date_range_end":"",
  "people":[], "organizations":[], "places":[], "addresses":[], "parcels":[], "blocks":[], "sheets":[], "independent_sections":[], "property_descriptions":[],
  "case_numbers":[], "notary_numbers":[], "registry_numbers":[], "account_numbers":[], "tax_numbers":[], "amounts":[], "currencies":[], "banks":[],
  "related_document_codes":[], "copy_of":"", "attachments":[], "issuer":"", "recipient":"", "signatories":[], "witnesses":[], "keywords":[], "summary":"", "notes":""
}

Markdown supplied for analysis:
"""${excerpt}"""`;
}

function normalizeMetadata(value: unknown): GeneratedMetadata {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const metadata: GeneratedMetadata = {};
  for (const [key, candidate] of Object.entries(input)) {
    if (systemMetadataKeys.has(key)) continue;
    if (Array.isArray(candidate)) {
      const values = candidate.filter((item): item is string | number | boolean =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      ).map((item) => typeof item === "string" ? item.trim() : item).filter((item) => item !== "");
      metadata[key] = values;
    } else if (typeof candidate === "string") {
      metadata[key] = candidate.trim();
    } else if (typeof candidate === "number" || typeof candidate === "boolean") {
      metadata[key] = candidate;
    }
  }
  metadata.language = typeof metadata.language === "string" && metadata.language ? metadata.language : "tr";
  for (const key of ["date", "date_range_start", "date_range_end"]) {
    const candidate = metadata[key];
    if (typeof candidate !== "string" || !candidate) continue;
    const normalized = canonicalizeDateValue(candidate);
    if (normalized) {
      metadata[key] = normalized;
      continue;
    }
    if (key === "date" && !metadata.date_text) metadata.date_text = candidate;
    metadata[key] = "";
  }
  return metadata;
}

function normalizeEvidenceText(value: string) {
  return value.normalize("NFC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[*_`]/g, "")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

/** Uses evidence transiently to reject non-verbatim metadata. Source snippets
 * are deliberately not persisted in YAML; ingestion builds its own evidence. */
export function groundMetadataInDocument(metadata: GeneratedMetadata, source: string) {
  const normalizedSource = normalizeEvidenceText(source);
  const grounded: GeneratedMetadata = {};
  for (const [key, raw] of Object.entries(metadata)) {
    const canonical = singleValueKeys.has(key) && Array.isArray(raw) ? raw.find((value) => String(value).trim()) ?? "" : raw;
    if (generatedValueKeys.has(key)) {
      grounded[key] = canonical;
      continue;
    }
    const values = Array.isArray(canonical) ? canonical : [canonical];
    const accepted = values.filter((value) => {
      const needle = normalizeEvidenceText(String(value));
      return Boolean(needle) && normalizedSource.includes(needle);
    });
    if (!accepted.length) continue;
    grounded[key] = Array.isArray(canonical) ? deduplicateMetadataList(accepted) : accepted[0]!;
  }
  return grounded;
}

/** A document with only a bracketed editorial annotation has no extractable
 * source content. This deliberately does not reject short, ordinary text. */
export function hasSubstantiveDocumentContent(source: string) {
  const bodyLines = source.replace(/\r\n/g, "\n").split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/[\\*_`]/g, "").trim())
    .filter(Boolean)
    .filter((line) => !/^\S+[/-]\S+$/.test(line));
  return bodyLines.some((line) => !/^\\?\[[^\]\n]+\\?\]$/.test(line));
}

/** For non-documents, retain only an exact source annotation as a note. */
export function preserveOnlySourceNotes(metadata: GeneratedMetadata, source: string): GeneratedMetadata {
  const rawNotes = metadata.notes;
  const values = Array.isArray(rawNotes) ? rawNotes : rawNotes === undefined ? [] : [rawNotes];
  const normalizedSource = normalizeEvidenceText(source);
  const note = values.find((value) => {
    const normalized = normalizeEvidenceText(String(value));
    return normalized && normalizedSource.includes(normalized);
  });
  return note === undefined ? {} : { notes: note };
}

/**
 * Keeps list metadata structurally consistent without inferring document
 * meaning. Exact repeats are always redundant. A bare identifier and the
 * same identifier with a source label are also redundant; the labeled source
 * value is retained because it preserves the identifier's kind.
 */
function deduplicateMetadataList(values: MetadataScalar[]) {
  const unique = new Map<string, MetadataScalar>();
  for (const value of values) {
    const normalized = normalizeEvidenceText(String(value));
    if (normalized && !unique.has(normalized)) unique.set(normalized, value);
  }

  const normalizedValues = [...unique.entries()];
  const bareIdentifiers = new Set(normalizedValues
    .map(([normalized]) => normalized)
    .filter((normalized) => /^[0-9][0-9 .,/\\-]*$/.test(normalized)));

  for (const bare of bareIdentifiers) {
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labeled = normalizedValues.find(([normalized]) => normalized !== bare
      && new RegExp(`(?:^|[:#\\s])${escaped}$`).test(normalized));
    if (labeled) unique.delete(bare);
  }
  return [...unique.values()];
}

function splitMetadataDocument(document: string, maximumCharacters = 12_000) {
  if (document.length <= maximumCharacters) return [document];
  const sections = document.split(/(?=^##?\s+)/m).filter((part) => part.trim());
  const parts: string[] = [];
  let current = "";
  for (const section of sections.length ? sections : [document]) {
    if (section.length > maximumCharacters) {
      if (current) { parts.push(current); current = ""; }
      for (let start = 0; start < section.length; start += maximumCharacters - 800) {
        parts.push(section.slice(start, start + maximumCharacters));
      }
      continue;
    }
    if (current && current.length + section.length > maximumCharacters) {
      parts.push(current);
      current = section;
    } else {
      current += section;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function mergeGeneratedMetadata(current: GeneratedMetadata, incoming: GeneratedMetadata) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === "" || Array.isArray(value) && value.length === 0) continue;
    if (["date", "date_range_start", "date_range_end"].includes(key) && merged[key] !== undefined && merged[key] !== value) {
      merged[key] = "";
      continue;
    }
    if (singleValueKeys.has(key) && merged[key] !== undefined) continue;
    merged[key] = singleValueKeys.has(key) && Array.isArray(value)
      ? value.find((item) => String(item).trim()) ?? ""
      : mergeMetadataValue(merged[key], value);
  }
  return merged;
}

function isOutputLimitError(error: unknown) {
  return error instanceof Error && /max_output_tokens/i.test(error.message);
}

async function generateCleanMetadata(
  llm: ReturnType<typeof getLlmProvider>,
  prompt: string,
  signal?: AbortSignal,
  rawOutput?: NonNullable<import("@knowledgeos/ai").GenerationOptions["rawOutput"]>
): Promise<unknown> {
  const characterRule = "\n\nOutput-quality rule: every JSON string must be valid Unicode text. Never emit replacement characters, mojibake, ASCII/control characters, question marks, or '(?)' in place of unreadable source text. If a metadata value cannot be transcribed with certainty, leave that scalar empty or omit that list item. Return the complete JSON object only.";
  const first = await llm.generateJsonObject<unknown>(`${prompt}${characterRule}`, signal, metadataJsonSchema(), rawOutput ? { rawOutput } : undefined);
  if (!containsInvalidMetadataCharacter(first)) return first;

  // A fresh generation is more reliable than editing a damaged string, since
  // the replacement character has discarded the original letter.
  const retry = await llm.generateJsonObject<unknown>(`${prompt}${characterRule}\n\nYour previous response contained invalid characters. Regenerate the entire JSON object from the Markdown and obey the output-quality rule exactly.`, signal, metadataJsonSchema(), rawOutput ? { rawOutput } : undefined);
  if (!containsInvalidMetadataCharacter(retry)) return retry;

  // Preserve useful fields from the retry, but never save a field whose text
  // has been damaged. List fields become [] and scalar fields become "".
  return blankInvalidMetadataFields(retry);
}

function containsInvalidMetadataCharacter(value: unknown): boolean {
  if (typeof value === "string") return invalidMetadataCharacter.test(value) || mojibakeMetadataCharacter.test(value) || uncertainReplacement.test(value);
  if (Array.isArray(value)) return value.some(containsInvalidMetadataCharacter);
  if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => invalidMetadataCharacter.test(key) || containsInvalidMetadataCharacter(item));
  return false;
}

function blankInvalidMetadataFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    containsInvalidMetadataCharacter(item) ? (Array.isArray(item) ? [] : "") : item
  ]));
}

function parseGeneratedJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? value).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last <= first) throw new HttpError(422, "The LLM did not return valid metadata JSON.");
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    throw new HttpError(422, "The LLM returned invalid metadata JSON.");
  }
}

function serializeMetadata(metadata: Record<string, MetadataValue>) {
  return `${Object.entries(metadata).map(([key, value]) => Array.isArray(value)
    ? (value.length ? `${key}:\n${value.map((item) => `  - ${JSON.stringify(item)}`).join("\n")}` : `${key}: []`)
    : `${key}: ${JSON.stringify(value)}`).join("\n")}\n`;
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

  const sourcePath = path.join(directory, safeName);
  const source = await readFile(sourcePath, "utf8");
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
      convertedAt: fileStat.mtime.toISOString(),
      hasYaml: false
    });
  }

  // The split documents are the working set. Keep the original DOCX and
  // extracted assets, but remove the now-redundant parent Markdown.
  await rm(sourcePath, { force: true });
  return { sourceFilename: safeName, files: created };
}
