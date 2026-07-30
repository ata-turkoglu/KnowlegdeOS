import path from "node:path";
import { and, count, eq, sql } from "drizzle-orm";
import { createDatabaseClient, documentEntities, documentFieldValues, entities, workspaceFields, workspaces } from "@knowledgeos/database";
import { normalizeForSearch } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { resolveStorageRoot } from "./storage.js";
import { getFieldMatcherEmbeddingProvider } from "./ai-providers.js";
import { recordSmallModelMetric } from "./small-model-metrics.js";

export type MetadataScalar = string | number | boolean;
export type MetadataValue = MetadataScalar | MetadataScalar[];
export type DynamicMetadata = Record<string, MetadataValue>;
export type WorkspaceFieldValueType = "TEXT" | "TEXT_ARRAY" | "DATE" | "NUMBER" | "BOOLEAN";

export type WorkspaceFieldDefinition = {
  id: string;
  workspaceId: string;
  key: string;
  label: string;
  valueType: WorkspaceFieldValueType;
  filterable: boolean;
  entityEnabled: boolean;
  searchable: boolean;
  aliases: string[];
};

const nonEntityKeys = new Set([
  "title", "summary", "notes", "language", "document_code", "source_original",
  "source_file", "ocr_status", "metadata_provider", "date", "date_text",
  "date_range_start", "date_range_end"
]);
const nonFilterableKeys = new Set(["summary", "notes", "source_original", "source_file"]);
const internalMetadataKeys = new Set(["metadata_evidence"]);
const dateKeys = new Set(["date", "date_range_start", "date_range_end"]);
const fieldEmbeddingCache = new Map<string, number[]>();
/** Modern archive guardrail: rejects OCR fragments such as `0974-10-24`. */
export const archivalDateBounds = { minYear: 1800, maxYear: new Date().getUTCFullYear() };

export function canonicalizeDateValue(value: string, bounds = archivalDateBounds) {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : local
      ? { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]) }
      : null;
  if (!parts) return null;
  if (parts.year < bounds.minYear || parts.year > bounds.maxYear) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) return null;
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function canonicalizeMetadataValue(key: string, value: MetadataValue): MetadataValue {
  if (!dateKeys.has(key)) return value;
  const canonicalize = (item: MetadataScalar): MetadataScalar =>
    typeof item === "string" ? canonicalizeDateValue(item) ?? item.trim() : item;
  return Array.isArray(value) ? value.map(canonicalize) : canonicalize(value);
}

export function normalizeMetadataKey(value: string) {
  return normalizeForSearch(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function metadataFieldLabel(key: string) {
  return key.split("_").filter(Boolean).map((part) => part[0]?.toLocaleUpperCase("tr-TR") + part.slice(1)).join(" ");
}

export function inferMetadataValueType(key: string, value: MetadataValue): WorkspaceFieldValueType {
  if (Array.isArray(value)) return "TEXT_ARRAY";
  if (dateKeys.has(key) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return "DATE";
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "boolean") return "BOOLEAN";
  return "TEXT";
}

export function widenMetadataValueType(
  current: WorkspaceFieldValueType,
  incoming: WorkspaceFieldValueType
): WorkspaceFieldValueType {
  if (current === incoming) return current;
  if (current === "TEXT_ARRAY" || incoming === "TEXT_ARRAY") return "TEXT_ARRAY";
  return "TEXT";
}

export function shouldIndexMetadataValue(key: string, value: MetadataValue) {
  if (nonEntityKeys.has(key)) return false;
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => String(item).trim().length > 0 && String(item).trim().length <= 256);
}

function fieldSettings(key: string, value: MetadataValue) {
  return {
    filterable: !nonFilterableKeys.has(key),
    entityEnabled: shouldIndexMetadataValue(key, value),
    searchable: !nonFilterableKeys.has(key)
  };
}

function compatibleTypes(left: WorkspaceFieldValueType, right: WorkspaceFieldValueType) {
  return left === right || left === "TEXT" || right === "TEXT" || left === "TEXT_ARRAY" || right === "TEXT_ARRAY";
}

function trigrams(value: string) {
  const padded = `  ${value} `;
  const result = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) result.add(padded.slice(index, index + 3));
  return result;
}

function trigramSimilarity(left: string, right: string) {
  const a = trigrams(left);
  const b = trigrams(right);
  const overlap = [...a].filter((item) => b.has(item)).length;
  return a.size + b.size ? 2 * overlap / (a.size + b.size) : 0;
}

async function resolveExistingField(
  config: ApiConfig,
  key: string,
  valueType: WorkspaceFieldValueType,
  fields: WorkspaceFieldDefinition[]
) {
  const exact = fields.find((field) => field.key === key || field.aliases.includes(key));
  if (exact) return exact;
  const candidates = fields
    .filter((field) => compatibleTypes(field.valueType, valueType))
    .map((field) => ({ field, score: trigramSimilarity(field.key, key) }))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1];
  if (best && best.score >= .92 && best.score - (second?.score ?? 0) >= .08) return best.field;
  // Avoid model work for unrelated fields. The semantic matcher refines
  // typo/translation-like lexical candidates; it is not allowed to compare
  // every arbitrary key against the entire catalog.
  if (!best || best.score < .18) return undefined;
  const compatible = fields.filter((field) => compatibleTypes(field.valueType, valueType)).slice(0, 50);
  if (!compatible.length) return undefined;
  recordSmallModelMetric("fieldMatcher", "attempt");
  try {
    const provider = getFieldMatcherEmbeddingProvider(config);
    const incoming = await provider.embed(`metadata field: ${key}`);
    const vectors = await Promise.all(compatible.map(async (field) => {
      const cacheKey = `${config.embeddingProvider}:${config.fieldMatcherModel}:${field.id}:${field.aliases.join(",")}`;
      const cached = fieldEmbeddingCache.get(cacheKey);
      if (cached) return cached;
      const vector = await provider.embed(`metadata field: ${field.key}; label: ${field.label}; aliases: ${field.aliases.join(", ")}`);
      fieldEmbeddingCache.set(cacheKey, vector);
      if (fieldEmbeddingCache.size > 2_000) fieldEmbeddingCache.delete(fieldEmbeddingCache.keys().next().value ?? "");
      return vector;
    }));
    const semantic = compatible.map((field, index) => ({ field, score: cosineSimilarity(incoming, vectors[index]) }))
      .sort((left, right) => right.score - left.score);
    const semanticBest = semantic[0];
    const semanticSecond = semantic[1];
    recordSmallModelMetric("fieldMatcher", "success");
    const accepted = semanticBest && semanticBest.score >= .86 && semanticBest.score - (semanticSecond?.score ?? 0) >= .05
      ? semanticBest.field
      : undefined;
    if (accepted) recordSmallModelMetric("fieldMatcher", "accepted");
    return accepted;
  } catch {
    recordSmallModelMetric("fieldMatcher", "fallback");
    return undefined;
  }
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function rowDefinition(row: typeof workspaceFields.$inferSelect): WorkspaceFieldDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.key,
    label: row.label,
    valueType: row.valueType as WorkspaceFieldValueType,
    filterable: row.filterable,
    entityEnabled: row.entityEnabled,
    searchable: row.searchable,
    aliases: row.aliases
  };
}

async function ensureWorkspace(
  db: any,
  config: ApiConfig,
  workspaceSlugInput: string
) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(workspaces).values({
    slug: workspaceSlug,
    name: workspaceSlug,
    storagePath: path.join(resolveStorageRoot(config.storageRoot), workspaceSlug)
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [concurrent] = await db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1);
  if (!concurrent) throw new Error("Workspace could not be created.");
  return concurrent;
}

export async function registerWorkspaceMetadataFields(
  config: ApiConfig,
  workspaceSlug: string,
  metadata: DynamicMetadata,
  dateBounds = archivalDateBounds
) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    return await client.db.transaction(async (tx) => {
      const workspace = await ensureWorkspace(tx, config, workspaceSlug);
      const rows = await tx.select().from(workspaceFields).where(eq(workspaceFields.workspaceId, workspace.id));
      const known = rows.map(rowDefinition);
      const canonical: DynamicMetadata = {};

      for (const [rawKey, value] of Object.entries(metadata)) {
        const key = normalizeMetadataKey(rawKey);
        if (!key || internalMetadataKeys.has(key)) continue;
        const canonicalValue = dateKeys.has(key)
          ? (Array.isArray(value)
            ? value.map((item) => typeof item === "string" ? canonicalizeDateValue(item, dateBounds) ?? item.trim() : item)
            : typeof value === "string" ? canonicalizeDateValue(value, dateBounds) ?? value.trim() : value)
          : canonicalizeMetadataValue(key, value);
        const incomingType = inferMetadataValueType(key, canonicalValue);
        const existing = await resolveExistingField(config, key, incomingType, known);
        if (existing) {
          const widened = widenMetadataValueType(existing.valueType, incomingType);
          const aliases = existing.key === key || existing.aliases.includes(key) ? existing.aliases : [...existing.aliases, key];
          const settings = fieldSettings(existing.key, canonicalValue);
          const [updated] = await tx.update(workspaceFields).set({
            valueType: widened,
            aliases,
            filterable: existing.filterable || settings.filterable,
            entityEnabled: existing.entityEnabled || settings.entityEnabled,
            searchable: existing.searchable || settings.searchable,
            updatedAt: new Date()
          }).where(eq(workspaceFields.id, existing.id)).returning();
          Object.assign(existing, rowDefinition(updated));
          canonical[existing.key] = mergeMetadataValue(canonical[existing.key], canonicalValue);
          continue;
        }

        const settings = fieldSettings(key, canonicalValue);
        const [created] = await tx.insert(workspaceFields).values({
          workspaceId: workspace.id,
          key,
          label: metadataFieldLabel(key),
          valueType: incomingType,
          aliases: [],
          ...settings
        }).onConflictDoUpdate({
          target: [workspaceFields.workspaceId, workspaceFields.key],
          set: { updatedAt: new Date() }
        }).returning();
        const definition = rowDefinition(created);
        known.push(definition);
        canonical[key] = mergeMetadataValue(canonical[key], canonicalValue);
      }
      return { workspace, metadata: canonical, fields: known };
    });
  } finally {
    await client.close();
  }
}

export function mergeMetadataValue(current: MetadataValue | undefined, incoming: MetadataValue): MetadataValue {
  if (current === undefined) return incoming;
  const values = [...(Array.isArray(current) ? current : [current]), ...(Array.isArray(incoming) ? incoming : [incoming])];
  const unique = [...new Map(values.map((value) => [normalizeForSearch(String(value)), value])).values()];
  return unique.length === 1 ? unique[0] : unique;
}

export async function getWorkspaceFields(config: ApiConfig, workspaceSlugInput: string) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const [workspace] = await client.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return [];
    const rows = await client.db.select({
      field: workspaceFields,
      entityCount: count(entities.id),
      documentCount: sql<number>`count(distinct ${documentEntities.documentId})`
    }).from(workspaceFields)
      .leftJoin(entities, eq(entities.fieldId, workspaceFields.id))
      .leftJoin(documentEntities, eq(documentEntities.entityId, entities.id))
      .where(eq(workspaceFields.workspaceId, workspace.id))
      .groupBy(workspaceFields.id)
      .orderBy(workspaceFields.key);
    return rows.map(({ field, entityCount, documentCount }) => ({
      ...rowDefinition(field),
      entityCount: Number(entityCount),
      documentCount: Number(documentCount)
    }));
  } finally {
    await client.close();
  }
}

export async function getWorkspaceFieldDefinitions(config: ApiConfig, workspaceSlugInput: string) {
  return (await getWorkspaceFields(config, workspaceSlugInput)).map(({ entityCount: _entityCount, documentCount: _documentCount, ...field }) => field);
}

export async function findWorkspaceField(
  config: ApiConfig,
  workspaceSlugInput: string,
  fieldKey: string
) {
  const fields = await getWorkspaceFieldDefinitions(config, workspaceSlugInput);
  const normalized = normalizeMetadataKey(fieldKey);
  return fields.find((field) => field.key === normalized || field.aliases.includes(normalized)) ?? null;
}

export async function replaceDocumentFieldValues(
  config: ApiConfig,
  workspaceSlug: string,
  documentId: string,
  metadata: DynamicMetadata,
  dateBounds = archivalDateBounds
) {
  const registered = await registerWorkspaceMetadataFields(config, workspaceSlug, metadata, dateBounds);
  const fieldByKey = new Map(registered.fields.map((field) => [field.key, field]));
  const client = createDatabaseClient(config.databaseUrl);
  try {
    await client.db.transaction(async (tx) => {
      await tx.delete(documentFieldValues).where(eq(documentFieldValues.documentId, documentId));
      const rows = Object.entries(registered.metadata).flatMap(([key, raw]) => {
        const field = fieldByKey.get(key);
        if (!field?.filterable) return [];
        return (Array.isArray(raw) ? raw : [raw]).flatMap((item, ordinal) => {
          const value = typeof item === "string" ? item.trim() : item;
          if (value === "") return [];
          const textValue = String(value);
          return [{
            documentId,
            fieldId: field.id,
            ordinal,
            textValue,
            normalizedValue: normalizeForSearch(textValue),
            dateValue: field.valueType === "DATE" ? canonicalizeDateValue(textValue, dateBounds) : null,
            numberValue: typeof value === "number" ? value : null,
            booleanValue: typeof value === "boolean" ? value : null
          }];
        });
      });
      if (rows.length) await tx.insert(documentFieldValues).values(rows);
    });
    return registered;
  } finally {
    await client.close();
  }
}
