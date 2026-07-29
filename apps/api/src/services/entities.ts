import { and, eq, inArray, sql } from "drizzle-orm";
import { chunkEntities, createDatabaseClient, documentChunks, documentEntities, documents, entities, entityAliases, propertyReferences, relationships, workspaceFields, workspaces } from "@knowledgeos/database";
import type { LLMRelationship } from "@knowledgeos/ai";
import { normalizeForSearch, type ExtractedEntity, type ExtractedPropertyReference } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import { registerWorkspaceMetadataFields, type DynamicMetadata } from "./workspace-fields.js";
import { getSmallLlmProvider } from "./ai-providers.js";
import { recordSmallModelMetric } from "./small-model-metrics.js";

export type EntityAlias = { alias: string; normalizedAlias: string; confidence: number; source: "REGEX" | "FRONTMATTER" | "LLM" | "USER" | "IMPORT" };
export type EntityAliasInput = { canonical: string; alias: string; confidence: number; source: "FRONTMATTER" | "LLM" };
export type EntityDocumentLink = { documentId?: string; documentName: string; title: string; markdownPath: string; mentionCount: number; maxChunkMentions: number; evidenceSnippet: string; confidence: number; chunkId?: string; chunkIndex?: number };
export type CanonicalEntity = { id: string; workspaceSlug: string; fieldId: string; fieldKey: string; fieldLabel: string; canonicalValue: string; normalizedValue: string; aliases: EntityAlias[]; documents: EntityDocumentLink[]; createdAt: string; updatedAt: string };
export type EntityIndex = { version: 1; workspaceSlug: string; updatedAt: string; entities: CanonicalEntity[] };

async function withDb<T>(config: ApiConfig, fn: (client: ReturnType<typeof createDatabaseClient>) => Promise<T>) { const client = createDatabaseClient(config.databaseUrl); try { return await fn(client); } finally { await client.close(); } }
async function workspace(db: any, slug: string) { const [row] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1); if (!row) throw new HttpError(404, "Workspace not found."); return row; }
const name = (filename: string) => slugify(filename.replace(/\.[^.]+$/, ""));
const aliasSource = (source: string): "LLM" | "FRONTMATTER" | "IMPORT" | "USER" | "REGEX" =>
  source === "LLM" ? "LLM" : source === "FRONTMATTER" ? "FRONTMATTER" : source === "IMPORT" ? "IMPORT" : source === "USER" ? "USER" : "REGEX";

export function resolveDocumentEntityAliases(extracted: ExtractedEntity[], declaredAliases: EntityAliasInput[] = []) {
  const priority = { FRONTMATTER: 3, LLM: 2, REGEX: 1 } as const;
  const deduped = new Map<string, ExtractedEntity>();
  for (const item of extracted) {
    const key = `${item.type}:${item.normalizedValue}`;
    const existing = deduped.get(key);
    if (!existing || priority[item.source] > priority[existing.source] || item.confidence > existing.confidence) deduped.set(key, item);
  }
  const canonicalPeople = [...deduped.values()].filter((item) => fieldKeyOf(item.type) === "people" && item.source !== "REGEX");
  const aliases = [...declaredAliases];
  for (const [key, item] of deduped) {
    if (fieldKeyOf(item.type) !== "people" || item.source !== "REGEX") continue;
    const matches = canonicalPeople.filter((canonical) => compatiblePersonName(canonical.normalizedValue, item.normalizedValue));
    if (matches.length !== 1 || matches[0].normalizedValue === item.normalizedValue) continue;
    deduped.delete(key);
    aliases.push({ canonical: matches[0].value, alias: item.value, confidence: Math.min(matches[0].confidence, item.confidence), source: matches[0].source === "LLM" ? "LLM" : "FRONTMATTER" });
  }
  return {
    entities: [...deduped.values()],
    aliases: [...new Map(aliases.filter((item) => normalizeForSearch(item.canonical) !== normalizeForSearch(item.alias)).map((item) => [`${normalizeForSearch(item.canonical)}:${normalizeForSearch(item.alias)}`, item])).values()]
  };
}

export async function replaceDocumentEntities(config: ApiConfig, workspaceSlug: string, documentId: string, extracted: ExtractedEntity[], declaredAliases: EntityAliasInput[] = []) {
  const dynamicMetadata: DynamicMetadata = {};
  for (const item of extracted) {
    const key = fieldKeyOf(item.type);
    const current = dynamicMetadata[key];
    dynamicMetadata[key] = [...new Set([...(Array.isArray(current) ? current : current === undefined ? [] : [current]), item.value])];
  }
  await registerWorkspaceMetadataFields(config, workspaceSlug, dynamicMetadata);
  await withDb(config, async ({ db }) => db.transaction(async (tx) => {
    const ws = await workspace(tx, slugify(workspaceSlug));
    const resolved = resolveDocumentEntityAliases(extracted, declaredAliases);
    const fields = await tx.select().from(workspaceFields).where(eq(workspaceFields.workspaceId, ws.id));
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const chunks = await tx.select().from(documentChunks).where(eq(documentChunks.documentId, documentId)).orderBy(documentChunks.chunkIndex);
    if (chunks.length) await tx.delete(chunkEntities).where(inArray(chunkEntities.chunkId, chunks.map((chunk) => chunk.id)));
    await tx.delete(documentEntities).where(eq(documentEntities.documentId, documentId));
    const byPersonValue = new Map<string, typeof entities.$inferSelect>();
    for (const item of resolved.entities) {
      const field = byKey.get(fieldKeyOf(item.type));
      if (!field?.entityEnabled || item.value.length > 256) continue;
      const [entity] = await tx.insert(entities).values({ fieldId: field.id, canonicalValue: item.value, normalizedValue: item.normalizedValue }).onConflictDoUpdate({ target: [entities.fieldId, entities.normalizedValue], set: { canonicalValue: item.value, updatedAt: new Date() } }).returning();
      // The canonical value is already searched directly; storing it again as
      // an alias adds noise and obscures the provenance of real variants.
      await tx.delete(entityAliases).where(and(eq(entityAliases.entityId, entity.id), eq(entityAliases.normalizedAlias, entity.normalizedValue)));
      const mentions = chunks.flatMap((chunk) => {
        const offsets = occurrenceOffsets(chunk.normalizedContent, item.normalizedValue);
        if (!offsets.length) return [];
        return [{
          chunkId: chunk.id,
          entityId: entity.id,
          mentionCount: offsets.length,
          firstOffset: offsets[0],
          evidenceSnippet: snippetAt(chunk.content, offsets[0], item.value.length),
          confidence: item.confidence,
          source: "TEXT_MATCH"
        }];
      });
      if (mentions.length) await tx.insert(chunkEntities).values(mentions).onConflictDoUpdate({
        target: [chunkEntities.chunkId, chunkEntities.entityId],
        set: {
          mentionCount: sql`excluded.mention_count`,
          firstOffset: sql`excluded.first_offset`,
          evidenceSnippet: sql`excluded.evidence_snippet`,
          confidence: sql`excluded.confidence`,
          source: sql`excluded.source`
        }
      });
      const mentionCount = mentions.reduce((sum, mention) => sum + mention.mentionCount, 0);
      const maxChunkMentions = mentions.reduce((max, mention) => Math.max(max, mention.mentionCount), 0);
      const evidenceSnippet = mentions[0]?.evidenceSnippet ?? item.evidenceSnippet;
      await tx.insert(documentEntities).values({ documentId, entityId: entity.id, mentionCount, maxChunkMentions, evidenceSnippet, confidence: item.confidence, source: item.source }).onConflictDoUpdate({ target: [documentEntities.documentId, documentEntities.entityId], set: { mentionCount, maxChunkMentions, evidenceSnippet, confidence: item.confidence, source: item.source } });
      if (field.key === "people") byPersonValue.set(item.normalizedValue, entity);
    }
    for (const item of resolved.aliases) {
      const entity = byPersonValue.get(normalizeForSearch(item.canonical));
      if (!entity) continue;
      await tx.insert(entityAliases).values({ entityId: entity.id, alias: item.alias, normalizedAlias: normalizeForSearch(item.alias), confidence: item.confidence, source: aliasSource(item.source) }).onConflictDoNothing();
    }
    await tx.delete(entities).where(and(
      inArray(entities.fieldId, fields.map((field) => field.id)),
      sql`not exists (select 1 from ${documentEntities} de where de.entity_id = ${entities.id})`
    ));
  }));
  await augmentChunkEntityLinks(config, workspaceSlug, documentId);
}

export async function replaceDocumentMetadataEntities(
  config: ApiConfig,
  workspaceSlug: string,
  documentId: string,
  metadata: DynamicMetadata
) {
  const registered = await registerWorkspaceMetadataFields(config, workspaceSlug, metadata);
  const fieldByKey = new Map(registered.fields.map((field) => [field.key, field]));
  const extracted: ExtractedEntity[] = [];
  for (const [key, raw] of Object.entries(registered.metadata)) {
    const field = fieldByKey.get(key);
    if (!field?.entityEnabled) continue;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const value = String(item).trim();
      if (!value || value.length > 256) continue;
      extracted.push({
        type: key,
        value,
        normalizedValue: normalizeForSearch(value),
        evidenceSnippet: `frontmatter:${key}=${value}`,
        confidence: .98,
        source: "FRONTMATTER"
      });
    }
  }
  return replaceDocumentEntities(config, workspaceSlug, documentId, extracted);
}

function fieldKeyOf(value: string) {
  const legacy: Record<string, string> = {
    PERSON: "people", PLACE: "places", PARCEL: "parcels", DATE: "dates",
    ORGANIZATION: "organizations", DOCUMENT_TYPE: "document_type",
    CASE_NUMBER: "case_numbers", NOTARY_NUMBER: "notary_numbers",
    PROPERTY: "property_descriptions", EVENT: "events", KEYWORD: "keywords"
  };
  return legacy[value] ?? value.toLocaleLowerCase("en-US");
}

function occurrenceOffsets(content: string, value: string) {
  if (!value) return [];
  const offsets: number[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(value, cursor);
    if (index < 0) break;
    offsets.push(index);
    cursor = index + Math.max(1, value.length);
  }
  return offsets;
}

function snippetAt(content: string, offset: number, length: number) {
  return content.slice(Math.max(0, offset - 120), Math.min(content.length, offset + length + 180)).replace(/\s+/g, " ").trim();
}

type ModelEntityLink = { chunkId?: string; entityId?: string; mentionText?: string; confidence?: number };

async function augmentChunkEntityLinks(config: ApiConfig, workspaceSlug: string, documentId: string) {
  try {
    const candidates = await withDb(config, async ({ db }) => {
      const ws = await workspace(db, slugify(workspaceSlug));
      const [chunks, linkedEntities, aliases, existing] = await Promise.all([
        db.select().from(documentChunks).where(eq(documentChunks.documentId, documentId)),
        db.select({ entity: entities }).from(documentEntities)
          .innerJoin(entities, eq(entities.id, documentEntities.entityId))
          .innerJoin(workspaceFields, eq(workspaceFields.id, entities.fieldId))
          .where(and(eq(documentEntities.documentId, documentId), eq(workspaceFields.workspaceId, ws.id))),
        db.select().from(entityAliases).where(inArray(entityAliases.entityId, db.select({ id: documentEntities.entityId }).from(documentEntities).where(eq(documentEntities.documentId, documentId)))),
        db.select().from(chunkEntities)
          .innerJoin(documentChunks, eq(documentChunks.id, chunkEntities.chunkId))
          .where(eq(documentChunks.documentId, documentId))
      ]);
      const existingPairs = new Set(existing.map((row) => `${row.chunk_entities.chunkId}:${row.chunk_entities.entityId}`));
      return linkedEntities.flatMap(({ entity }) => {
        const variants = [entity.canonicalValue, ...aliases.filter((alias) => alias.entityId === entity.id).map((alias) => alias.alias)];
        const tokens = [...new Set(variants.flatMap((value) => normalizeForSearch(value).split(" ")).filter((token) => token.length >= 4))];
        return chunks.flatMap((chunk) => {
          if (existingPairs.has(`${chunk.id}:${entity.id}`)) return [];
          const chunkTokens = [...new Set(chunk.normalizedContent.split(" ").filter((token) => token.length >= 4))];
          const tokenMatch = tokens.some((token) => chunkTokens.some((chunkToken) => token === chunkToken || tokenSimilarity(token, chunkToken) >= .78));
          if (!tokenMatch) return [];
          return [{
            chunkId: chunk.id,
            entityId: entity.id,
            content: chunk.content.slice(0, 1_500),
            normalizedContent: chunk.normalizedContent,
            canonicalValue: entity.canonicalValue,
            variants
          }];
        });
      }).slice(0, 80);
    });
    if (!candidates.length) return;
    recordSmallModelMetric("entityLinker", "attempt");
    const prompt = `<task>
Link an exact mention copied from a chunk to one of the allowed existing entities.
Return JSON only: {"links":[{"chunkId":"allowed id","entityId":"allowed id","mentionText":"exact substring copied from content","confidence":0.0}]}.
Do not create entities, aliases, IDs, or corrected text. Omit uncertain links.
</task>
<candidates>${JSON.stringify(candidates.map(({ normalizedContent: _normalizedContent, ...candidate }) => candidate))}</candidates>`;
    const result = await getSmallLlmProvider(config, "entityLinker").generateJsonObject<{ links?: ModelEntityLink[] }>(prompt);
    recordSmallModelMetric("entityLinker", "success");
    const allowed = new Map(candidates.map((candidate) => [`${candidate.chunkId}:${candidate.entityId}`, candidate]));
    const accepted = (result.links ?? []).flatMap((link) => {
      const candidate = link.chunkId && link.entityId ? allowed.get(`${link.chunkId}:${link.entityId}`) : undefined;
      const mentionText = link.mentionText?.trim() ?? "";
      const confidence = Number(link.confidence);
      if (!candidate || !mentionText || !Number.isFinite(confidence) || confidence < .88) return [];
      const normalizedMention = normalizeForSearch(mentionText);
      const firstOffset = candidate.normalizedContent.indexOf(normalizedMention);
      if (firstOffset < 0 || !entityMentionCompatible(normalizedMention, candidate.variants)) return [];
      return [{
        chunkId: candidate.chunkId,
        entityId: candidate.entityId,
        mentionCount: Math.max(1, occurrenceOffsets(candidate.normalizedContent, normalizedMention).length),
        firstOffset,
        evidenceSnippet: snippetAt(candidate.content, firstOffset, mentionText.length),
        confidence: Math.min(1, confidence),
        source: "SMALL_MODEL"
      }];
    });
    if (!accepted.length) return;
    recordSmallModelMetric("entityLinker", "accepted", accepted.length);
    await withDb(config, async ({ db }) => db.transaction(async (tx) => {
      for (const link of accepted) await tx.insert(chunkEntities).values(link).onConflictDoNothing();
      await tx.update(documentEntities).set({
        mentionCount: sql`coalesce((
          select sum(ce.mention_count)::int
          from ${chunkEntities} ce
          join ${documentChunks} dc on dc.id = ce.chunk_id
          where dc.document_id = ${documentEntities.documentId}
            and ce.entity_id = ${documentEntities.entityId}
        ), 0)`,
        maxChunkMentions: sql`coalesce((
          select max(ce.mention_count)::int
          from ${chunkEntities} ce
          join ${documentChunks} dc on dc.id = ce.chunk_id
          where dc.document_id = ${documentEntities.documentId}
            and ce.entity_id = ${documentEntities.entityId}
        ), 0)`
      }).where(eq(documentEntities.documentId, documentId));
    }));
  } catch {
    recordSmallModelMetric("entityLinker", "fallback");
    // Small-model linking is optional enrichment. Exact/alias links remain valid.
  }
}

export function entityMentionCompatible(mention: string, variants: string[]) {
  const normalized = normalizeForSearch(mention);
  return variants.some((variant) => {
    const expected = normalizeForSearch(variant);
    if (normalized.includes(expected) || expected.includes(normalized)) return true;
    const left = new Set(normalized.split(" ").filter(Boolean));
    const right = new Set(expected.split(" ").filter(Boolean));
    const overlap = [...left].filter((token) => right.has(token)).length;
    if (overlap >= Math.min(2, right.size) && overlap / Math.max(left.size, right.size) >= .5) return true;
    return left.size >= 2 && right.size >= 2 && [...left].some((leftToken) =>
      leftToken.length >= 5 && [...right].some((rightToken) => rightToken.length >= 5 && tokenSimilarity(leftToken, rightToken) >= .78)
    );
  });
}

export function tokenSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      result.set(pair, (result.get(pair) ?? 0) + 1);
    }
    return result;
  };
  const leftPairs = pairs(left);
  const rightPairs = pairs(right);
  let overlap = 0;
  for (const [pair, count] of leftPairs) overlap += Math.min(count, rightPairs.get(pair) ?? 0);
  return 2 * overlap / Math.max(1, left.length + right.length - 2);
}

export async function replaceDocumentPropertyReferences(config: ApiConfig, workspaceSlug: string, documentId: string, extracted: ExtractedPropertyReference[]) {
  return withDb(config, async ({ db }) => db.transaction(async (tx) => {
    const ws = await workspace(tx, slugify(workspaceSlug));
    await tx.delete(propertyReferences).where(eq(propertyReferences.documentId, documentId));
    if (!extracted.length) return;
    await tx.insert(propertyReferences).values(extracted.map((item) => ({
      workspaceId: ws.id,
      documentId,
      place: item.place,
      normalizedPlace: item.normalizedPlace,
      sheet: item.sheet,
      block: item.block,
      parcel: item.parcel,
      normalizedKey: item.normalizedKey,
      evidenceSnippet: item.evidenceSnippet,
      confidence: item.confidence,
      source: aliasSource(item.source)
    }))).onConflictDoNothing();
  }));
}

function compatiblePersonName(canonical: string, alias: string) {
  if (canonical === alias) return true;
  const canonicalTokens = canonical.split(" ");
  const aliasTokens = alias.split(" ");
  if (canonicalTokens.length < 2 || aliasTokens.length < 2) return false;
  const canonicalJoined = ` ${canonical} `;
  const aliasJoined = ` ${alias} `;
  if (canonicalJoined.includes(aliasJoined) || aliasJoined.includes(canonicalJoined)) return true;
  const firstMatches = canonicalTokens[0] === aliasTokens[0] || canonicalTokens[0][0] === aliasTokens[0][0] && aliasTokens[0].length === 1;
  const canonicalLast = canonicalTokens.at(-1) ?? "";
  const aliasLast = aliasTokens.at(-1) ?? "";
  const lastMatches = canonicalLast === aliasLast
    || canonicalLast.startsWith(aliasLast) && canonicalLast.length - aliasLast.length <= 3
    || aliasLast.startsWith(canonicalLast) && aliasLast.length - canonicalLast.length <= 3;
  return firstMatches && lastMatches;
}

/** Replaces LLM-extracted, evidence-backed links for one document. */
export async function replaceDocumentRelationships(config: ApiConfig, workspaceSlug: string, documentId: string, extracted: LLMRelationship[]) {
  return withDb(config, async ({ db }) => db.transaction(async (tx) => {
    const ws = await workspace(tx, slugify(workspaceSlug));
    await tx.delete(relationships).where(and(eq(relationships.documentId, documentId), eq(relationships.origin, "LLM")));
    if (!extracted.length) return;

    const [document] = await tx.select({ content: documents.content }).from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return;
    const indexedEntities = await tx.select({ entity: entities })
      .from(documentEntities).innerJoin(entities, eq(entities.id, documentEntities.entityId))
      .where(eq(documentEntities.documentId, documentId));
    const ids = indexedEntities.map(({ entity }) => entity.id);
    const aliases = ids.length ? await tx.select().from(entityAliases).where(inArray(entityAliases.entityId, ids)) : [];
    const byNormalizedValue = new Map<string, typeof entities.$inferSelect>();
    for (const { entity } of indexedEntities) byNormalizedValue.set(entity.normalizedValue, entity);
    for (const alias of aliases) {
      const entity = indexedEntities.find((item) => item.entity.id === alias.entityId)?.entity;
      if (entity) byNormalizedValue.set(alias.normalizedAlias, entity);
    }
    const normalizedContent = normalizeForSearch(document.content);
    const seen = new Set<string>();

    for (const item of extracted) {
      const source = byNormalizedValue.get(normalizeForSearch(item.source));
      const target = byNormalizedValue.get(normalizeForSearch(item.target));
      const relation = item.relation.trim();
      const evidenceSnippet = item.evidence.trim();
      const normalizedEvidence = normalizeForSearch(evidenceSnippet);
      if (!source || !target || source.id === target.id || !relation || !normalizedEvidence) continue;
      if (!normalizedContent.includes(normalizedEvidence)) continue;
      if (!evidenceMentionsEntity(normalizedEvidence, source, aliases) || !evidenceMentionsEntity(normalizedEvidence, target, aliases)) continue;
      const key = `${source.id}:${relation}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.insert(relationships).values({ workspaceId: ws.id, documentId, sourceEntityId: source.id, relation, targetEntityId: target.id, evidenceSnippet, confidence: 0.8, origin: "LLM" });
    }
  }));
}

function evidenceMentionsEntity(evidence: string, entity: typeof entities.$inferSelect, aliases: Array<typeof entityAliases.$inferSelect>) {
  if (evidence.includes(entity.normalizedValue)) return true;
  return aliases.some((alias) => alias.entityId === entity.id && evidence.includes(alias.normalizedAlias));
}

async function list(config: ApiConfig, workspaceSlug: string): Promise<CanonicalEntity[]> { const slug = slugify(workspaceSlug); return withDb(config, async ({ db }) => { const ws = await workspace(db, slug); const rows = await db.select({ entity: entities, field: workspaceFields }).from(entities).innerJoin(workspaceFields, eq(workspaceFields.id, entities.fieldId)).where(eq(workspaceFields.workspaceId, ws.id)); return Promise.all(rows.map(async ({ entity, field }) => { const aliases = await db.select().from(entityAliases).where(eq(entityAliases.entityId, entity.id)); const links = await db.select({ documentId: documents.id, filename: documents.filename, title: documents.title, markdownPath: documents.markdownPath, mentionCount: documentEntities.mentionCount, maxChunkMentions: documentEntities.maxChunkMentions, evidenceSnippet: documentEntities.evidenceSnippet, confidence: documentEntities.confidence }).from(documentEntities).innerJoin(documents, eq(documents.id, documentEntities.documentId)).where(eq(documentEntities.entityId, entity.id)); return { id: entity.id, workspaceSlug: slug, fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, canonicalValue: entity.canonicalValue, normalizedValue: entity.normalizedValue, aliases: aliases.map((a) => ({ alias: a.alias, normalizedAlias: a.normalizedAlias, confidence: a.confidence, source: a.source })), documents: links.map((link) => ({ documentId: link.documentId, documentName: name(link.filename), title: link.title, markdownPath: link.markdownPath, mentionCount: link.mentionCount, maxChunkMentions: link.maxChunkMentions, evidenceSnippet: link.evidenceSnippet, confidence: link.confidence })), createdAt: entity.createdAt.toISOString(), updatedAt: entity.updatedAt.toISOString() } as CanonicalEntity; })); }); }
export async function listEntities(config: ApiConfig, workspaceSlug: string) { return list(config, workspaceSlug); }
export async function readEntityIndex(config: ApiConfig, workspaceSlug: string): Promise<EntityIndex> { const items = await list(config, workspaceSlug); return { version: 1, workspaceSlug: slugify(workspaceSlug), updatedAt: new Date().toISOString(), entities: items }; }
export async function rebuildEntityIndex(config: ApiConfig, workspaceSlug: string) { return readEntityIndex(config, workspaceSlug); }
export async function getEntity(config: ApiConfig, workspaceSlug: string, id: string) { const entity = (await list(config, workspaceSlug)).find((item) => item.id === id); if (!entity) throw new HttpError(404, "Entity not found."); return entity; }
export async function addEntityAlias(config: ApiConfig, workspaceSlug: string, id: string, alias: string) { if (!alias.trim()) throw new HttpError(400, "Alias is required."); return withDb(config, async ({ db }) => { const entity = await getEntity(config, workspaceSlug, id); await db.insert(entityAliases).values({ entityId: id, alias: alias.trim(), normalizedAlias: normalizeForSearch(alias), source: "USER" }).onConflictDoNothing(); return getEntity(config, workspaceSlug, entity.id); }); }
export async function removeEntityAlias(config: ApiConfig, workspaceSlug: string, id: string, normalizedAlias: string) { return withDb(config, async ({ db }) => { await db.delete(entityAliases).where(and(eq(entityAliases.entityId, id), eq(entityAliases.normalizedAlias, normalizedAlias), eq(entityAliases.source, "USER"))); return getEntity(config, workspaceSlug, id); }); }
export async function mergeEntities(config: ApiConfig, workspaceSlug: string, sourceId: string, targetId: string) { if (sourceId === targetId) throw new HttpError(400, "Source and target entities must be different."); return withDb(config, async ({ db }) => { const [source, target] = await Promise.all([getEntity(config, workspaceSlug, sourceId), getEntity(config, workspaceSlug, targetId)]); if (source.fieldId !== target.fieldId) throw new HttpError(400, "Only entities in the same metadata field can be merged."); for (const alias of [source.canonicalValue, ...source.aliases.map((a) => a.alias)]) await db.insert(entityAliases).values({ entityId: targetId, alias, normalizedAlias: normalizeForSearch(alias), source: "USER" }).onConflictDoNothing(); const links = await db.select().from(documentEntities).where(eq(documentEntities.entityId, sourceId)); for (const link of links) await db.insert(documentEntities).values({ documentId: link.documentId, entityId: targetId, mentionCount: link.mentionCount, maxChunkMentions: link.maxChunkMentions, evidenceSnippet: link.evidenceSnippet, confidence: link.confidence, source: link.source }).onConflictDoNothing(); const chunkLinks = await db.select().from(chunkEntities).where(eq(chunkEntities.entityId, sourceId)); for (const link of chunkLinks) await db.insert(chunkEntities).values({ chunkId: link.chunkId, entityId: targetId, mentionCount: link.mentionCount, firstOffset: link.firstOffset, evidenceSnippet: link.evidenceSnippet, confidence: link.confidence, source: link.source }).onConflictDoNothing(); await db.delete(entities).where(eq(entities.id, sourceId)); return getEntity(config, workspaceSlug, targetId); }); }
