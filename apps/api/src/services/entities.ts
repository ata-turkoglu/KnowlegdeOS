import { and, eq } from "drizzle-orm";
import { createDatabaseClient, documentEntities, documents, entities, entityAliases, relationships, workspaces } from "@knowledgeos/database";
import type { LLMRelationship } from "@knowledgeos/ai";
import type { EntityType } from "@knowledgeos/shared";
import { normalizeForSearch, type ExtractedEntity } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";

export type EntityAlias = { alias: string; normalizedAlias: string; confidence: number; source: "REGEX" | "FRONTMATTER" | "USER" | "IMPORT" };
export type EntityDocumentLink = { documentId?: string; documentName: string; title: string; markdownPath: string; occurrenceCount: number; evidenceSnippet: string; confidence: number };
export type CanonicalEntity = { id: string; workspaceSlug: string; type: EntityType; canonicalValue: string; normalizedValue: string; aliases: EntityAlias[]; documents: EntityDocumentLink[]; createdAt: string; updatedAt: string };
export type EntityIndex = { version: 1; workspaceSlug: string; updatedAt: string; entities: CanonicalEntity[] };

async function withDb<T>(config: ApiConfig, fn: (client: ReturnType<typeof createDatabaseClient>) => Promise<T>) { const client = createDatabaseClient(config.databaseUrl); try { return await fn(client); } finally { await client.close(); } }
async function workspace(db: any, slug: string) { const [row] = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1); if (!row) throw new HttpError(404, "Workspace not found."); return row; }
const name = (filename: string) => slugify(filename.replace(/\.[^.]+$/, ""));
const aliasSource = (source: string) => source === "LLM" ? "LLM" : source === "IMPORT" ? "IMPORT" : "REGEX" as const;

export async function replaceDocumentEntities(config: ApiConfig, workspaceSlug: string, documentId: string, extracted: ExtractedEntity[]) {
  return withDb(config, async ({ db }) => db.transaction(async (tx) => {
    const ws = await workspace(tx, slugify(workspaceSlug));
    await tx.delete(documentEntities).where(eq(documentEntities.documentId, documentId));
    for (const item of extracted) {
      const [entity] = await tx.insert(entities).values({ workspaceId: ws.id, type: item.type, canonicalValue: item.value, normalizedValue: item.normalizedValue }).onConflictDoUpdate({ target: [entities.workspaceId, entities.type, entities.normalizedValue], set: { canonicalValue: item.value, updatedAt: new Date() } }).returning();
      await tx.insert(entityAliases).values({ entityId: entity.id, alias: item.value, normalizedAlias: item.normalizedValue, confidence: item.confidence, source: aliasSource(item.source) }).onConflictDoNothing();
      await tx.insert(documentEntities).values({ documentId, entityId: entity.id, occurrenceCount: 1, evidenceSnippet: item.evidenceSnippet, confidence: item.confidence }).onConflictDoUpdate({ target: [documentEntities.documentId, documentEntities.entityId], set: { occurrenceCount: 1, evidenceSnippet: item.evidenceSnippet, confidence: item.confidence } });
    }
  }));
}

/** Replaces LLM-extracted, evidence-backed links for one document. */
export async function replaceDocumentRelationships(config: ApiConfig, workspaceSlug: string, documentId: string, extracted: LLMRelationship[]) {
  return withDb(config, async ({ db }) => db.transaction(async (tx) => {
    const ws = await workspace(tx, slugify(workspaceSlug));
    await tx.delete(relationships).where(and(eq(relationships.documentId, documentId), eq(relationships.origin, "LLM")));
    if (!extracted.length) return;

    const indexedEntities = await tx.select().from(entities).where(eq(entities.workspaceId, ws.id));
    const byNormalizedValue = new Map(indexedEntities.map((entity) => [entity.normalizedValue, entity]));
    const seen = new Set<string>();

    for (const item of extracted) {
      const source = byNormalizedValue.get(normalizeForSearch(item.source));
      const target = byNormalizedValue.get(normalizeForSearch(item.target));
      const relation = item.relation.trim();
      const evidenceSnippet = item.evidence.trim();
      if (!source || !target || source.id === target.id || !relation || !evidenceSnippet) continue;
      const key = `${source.id}:${relation}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.insert(relationships).values({ workspaceId: ws.id, documentId, sourceEntityId: source.id, relation, targetEntityId: target.id, evidenceSnippet, confidence: 0.8, origin: "LLM" });
    }
  }));
}

/**
 * Adds conservative no-LLM graph links. They only mean two entities occur in
 * the same document; they never imply ownership, kinship, or a legal action.
 */
export async function replaceDocumentRuleRelationships(config: ApiConfig, workspaceSlug: string, documentId: string) {
  return withDb(config, async ({ db }) => db.transaction(async (tx) => {
    const ws = await workspace(tx, slugify(workspaceSlug));
    await tx.delete(relationships).where(and(eq(relationships.documentId, documentId), eq(relationships.origin, "RULE")));
    const indexed = await tx.select({ id: entities.id, type: entities.type, value: entities.canonicalValue })
      .from(documentEntities).innerJoin(entities, eq(entities.id, documentEntities.entityId))
      .where(eq(documentEntities.documentId, documentId));
    const people = indexed.filter((entity) => entity.type === "PERSON");
    const pairs: Array<{ source: typeof indexed[number]; relation: string; target: typeof indexed[number] }> = [];
    const addPersonLinks = (targetType: "PARCEL" | "PLACE" | "ORGANIZATION", relation: string) => {
      const targets = indexed.filter((entity) => entity.type === targetType);
      for (const source of people) for (const target of targets) pairs.push({ source, relation, target });
    };
    addPersonLinks("PARCEL", "PARSELLE_ANILIR");
    addPersonLinks("PLACE", "YERLE_ANILIR");
    addPersonLinks("ORGANIZATION", "KURUMLA_ANILIR");
    for (let left = 0; left < people.length; left += 1) for (let right = left + 1; right < people.length; right += 1) {
      const [source, target] = [people[left], people[right]].sort((a, b) => a.id.localeCompare(b.id));
      pairs.push({ source, relation: "AYNI_BELGEDE_ANILIR", target });
    }
    const seen = new Set<string>();
    for (const { source, relation, target } of pairs) {
      const key = `${source.id}:${relation}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.insert(relationships).values({ workspaceId: ws.id, documentId, sourceEntityId: source.id, relation, targetEntityId: target.id, evidenceSnippet: `${source.value} ve ${target.value} aynı belgede birlikte anılmaktadır.`, confidence: 0.4, origin: "RULE" });
    }
  }));
}

async function list(config: ApiConfig, workspaceSlug: string): Promise<CanonicalEntity[]> { const slug = slugify(workspaceSlug); return withDb(config, async ({ db }) => { const ws = await workspace(db, slug); const rows = await db.select().from(entities).where(eq(entities.workspaceId, ws.id)); return Promise.all(rows.map(async (entity) => { const aliases = await db.select().from(entityAliases).where(eq(entityAliases.entityId, entity.id)); const links = await db.select({ documentId: documents.id, filename: documents.filename, title: documents.title, markdownPath: documents.markdownPath, occurrenceCount: documentEntities.occurrenceCount, evidenceSnippet: documentEntities.evidenceSnippet, confidence: documentEntities.confidence }).from(documentEntities).innerJoin(documents, eq(documents.id, documentEntities.documentId)).where(eq(documentEntities.entityId, entity.id)); return { id: entity.id, workspaceSlug: slug, type: entity.type, canonicalValue: entity.canonicalValue, normalizedValue: entity.normalizedValue, aliases: aliases.map((a) => ({ alias: a.alias, normalizedAlias: a.normalizedAlias, confidence: a.confidence, source: a.source === "LLM" ? "REGEX" : a.source })), documents: links.map((link) => ({ documentId: link.documentId, documentName: name(link.filename), title: link.title, markdownPath: link.markdownPath, occurrenceCount: link.occurrenceCount, evidenceSnippet: link.evidenceSnippet, confidence: link.confidence })), createdAt: entity.createdAt.toISOString(), updatedAt: entity.updatedAt.toISOString() } as CanonicalEntity; })); }); }
export async function listEntities(config: ApiConfig, workspaceSlug: string) { return list(config, workspaceSlug); }
export async function readEntityIndex(config: ApiConfig, workspaceSlug: string): Promise<EntityIndex> { const items = await list(config, workspaceSlug); return { version: 1, workspaceSlug: slugify(workspaceSlug), updatedAt: new Date().toISOString(), entities: items }; }
export async function rebuildEntityIndex(config: ApiConfig, workspaceSlug: string) { return readEntityIndex(config, workspaceSlug); }
export async function getEntity(config: ApiConfig, workspaceSlug: string, id: string) { const entity = (await list(config, workspaceSlug)).find((item) => item.id === id); if (!entity) throw new HttpError(404, "Entity not found."); return entity; }
export async function addEntityAlias(config: ApiConfig, workspaceSlug: string, id: string, alias: string) { if (!alias.trim()) throw new HttpError(400, "Alias is required."); return withDb(config, async ({ db }) => { const entity = await getEntity(config, workspaceSlug, id); await db.insert(entityAliases).values({ entityId: id, alias: alias.trim(), normalizedAlias: normalizeForSearch(alias), source: "USER" }).onConflictDoNothing(); return getEntity(config, workspaceSlug, entity.id); }); }
export async function removeEntityAlias(config: ApiConfig, workspaceSlug: string, id: string, normalizedAlias: string) { return withDb(config, async ({ db }) => { await db.delete(entityAliases).where(and(eq(entityAliases.entityId, id), eq(entityAliases.normalizedAlias, normalizedAlias), eq(entityAliases.source, "USER"))); return getEntity(config, workspaceSlug, id); }); }
export async function mergeEntities(config: ApiConfig, workspaceSlug: string, sourceId: string, targetId: string) { if (sourceId === targetId) throw new HttpError(400, "Source and target entities must be different."); return withDb(config, async ({ db }) => { const [source, target] = await Promise.all([getEntity(config, workspaceSlug, sourceId), getEntity(config, workspaceSlug, targetId)]); if (source.type !== target.type) throw new HttpError(400, "Only entities with the same type can be merged."); for (const alias of [source.canonicalValue, ...source.aliases.map((a) => a.alias)]) await db.insert(entityAliases).values({ entityId: targetId, alias, normalizedAlias: normalizeForSearch(alias), source: "USER" }).onConflictDoNothing(); const links = await db.select().from(documentEntities).where(eq(documentEntities.entityId, sourceId)); for (const link of links) await db.insert(documentEntities).values({ documentId: link.documentId, entityId: targetId, occurrenceCount: link.occurrenceCount, evidenceSnippet: link.evidenceSnippet, confidence: link.confidence }).onConflictDoNothing(); await db.delete(entities).where(eq(entities.id, sourceId)); return getEntity(config, workspaceSlug, targetId); }); }
