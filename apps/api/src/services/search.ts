import { normalizeForSearch } from '@knowledgeos/ingestion';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, workspaces } from '@knowledgeos/database';
import type { ApiConfig } from '../config/env.js';
import { type CanonicalEntity, type EntityAlias } from './entities.js';
import { slugify } from '../lib/slug.js';
import type { MetadataFilters } from './rag-core.js';

export type EntitySearchResult = {
  queryType: 'ENTITY_SEARCH';
  query: string;
  normalizedQuery: string;
  matchedEntity: {
    id: string;
    fieldId: string;
    fieldKey: string;
    fieldLabel: string;
    canonicalValue: string;
  } | null;
  matchedAliases: EntityAlias[];
  retrievedDocuments: CanonicalEntity['documents'];
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    matchedAliases: string[];
  }>;
};

type EntitySearchRow = {
  entity_id: string;
  document_id: string;
  field_id: string;
  field_key: string;
  field_label: string;
  canonical_value: string;
  normalized_value: string;
  alias: string | null;
  normalized_alias: string | null;
  alias_confidence: number | null;
  alias_source: string | null;
  document_confidence: number;
  filename: string;
  title: string;
  evidence_snippet: string;
  mention_count: number;
  max_chunk_mentions: number;
  chunk_id: string | null;
  chunk_index: number | null;
  score: number;
};

/**
 * Workspace içindeki canonical entity, alias ve belge bağlantılarını arar.
 *
 * Metadata planner tarafından verilen belge kapsamı bütün sorguya kesin sınır
 * olarak uygulanır. Boş `allowedDocumentIds` dizisi, hiçbir belgenin eşleşmediği
 * anlamına gelir ve tüm workspace üzerinde aramaya dönüştürülmez.
 */
export async function searchEntityDocuments(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    query: string;
    filters?: MetadataFilters;
    entityIds?: string[];
    limit?: number;
  },
): Promise<EntitySearchResult> {
  const normalizedQuery = normalizeForSearch(extractEntityQuery(input.query));
  const allowedDocumentIds = input.filters?.allowedDocumentIds;
  const entityIds = uniqueValidUuidValues(input.entityIds);
  const limit = normalizeEntitySearchLimit(input.limit);

  // `undefined` kapsam kısıtı olmadığını, boş dizi ise filtrelerle hiçbir
  // belgenin eşleşmediğini ifade eder.
  if (Array.isArray(allowedDocumentIds) && allowedDocumentIds.length === 0) {
    return empty(input.query, normalizedQuery);
  }

  if (!normalizedQuery && entityIds.length === 0) {
    return empty(input.query, normalizedQuery);
  }

  const client = createDatabaseClient(config.databaseUrl);

  try {
    const [workspace] = await client.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slugify(input.workspaceSlug)))
      .limit(1);

    if (!workspace) {
      return empty(input.query, normalizedQuery);
    }

    const allowedIds =
      allowedDocumentIds === undefined
        ? null
        : uniqueValidUuidValues(allowedDocumentIds);
    const constrainedEntityIds = entityIds.length > 0 ? entityIds : null;
    const hasQuery = normalizedQuery.length > 0;

    const rows = await client.queryClient<EntitySearchRow[]>`
      select
        e.id as entity_id,
        d.id as document_id,
        f.id as field_id,
        f.key as field_key,
        f.label as field_label,
        e.canonical_value,
        e.normalized_value,
        a.alias,
        a.normalized_alias,
        a.confidence::float8 as alias_confidence,
        a.source::text as alias_source,
        de.confidence::float8 as document_confidence,
        d.filename,
        d.title,
        coalesce(
          best_chunk.evidence_snippet,
          de.evidence_snippet,
          ''
        ) as evidence_snippet,
        de.mention_count,
        de.max_chunk_mentions,
        best_chunk.chunk_id,
        best_chunk.chunk_index,
        case
          when e.id = any(
            coalesce(
              ${constrainedEntityIds}::uuid[],
              '{}'::uuid[]
            )
          ) then 120
          when ${hasQuery}
            and (
              e.normalized_value = ${normalizedQuery}
              or a.normalized_alias = ${normalizedQuery}
            ) then 100
          when ${hasQuery}
            and (
              ${normalizedQuery} like
                '%' || e.normalized_value || '%'
              or ${normalizedQuery} like
                '%' || a.normalized_alias || '%'
            ) then 90
          when ${hasQuery} then
            greatest(
              similarity(
                e.normalized_value,
                ${normalizedQuery}
              ),
              coalesce(
                similarity(
                  a.normalized_alias,
                  ${normalizedQuery}
                ),
                0
              )
            ) * 80
          else 0
        end::float8 as score
      from entities e
      join workspace_fields f
        on f.id = e.field_id
      left join entity_aliases a
        on a.entity_id = e.id
      join document_entities de
        on de.entity_id = e.id
      join documents d
        on d.id = de.document_id
      left join lateral (
        select
          ce.chunk_id,
          dc.chunk_index,
          ce.evidence_snippet
        from chunk_entities ce
        join document_chunks dc
          on dc.id = ce.chunk_id
        where ce.entity_id = e.id
          and dc.document_id = d.id
        order by
          ce.mention_count desc,
          ce.confidence desc,
          dc.chunk_index asc
        limit 1
      ) best_chunk on true
      where f.workspace_id = ${workspace.id}
        and d.workspace_id = ${workspace.id}
        and d.status = 'INDEXED'
        and (
          ${allowedIds}::uuid[] is null
          or d.id = any(${allowedIds}::uuid[])
        )
        and (
          e.id = any(
            coalesce(
              ${constrainedEntityIds}::uuid[],
              '{}'::uuid[]
            )
          )
          or (
            ${hasQuery}
            and (
              e.normalized_value = ${normalizedQuery}
              or a.normalized_alias = ${normalizedQuery}
              or ${normalizedQuery} like
                '%' || e.normalized_value || '%'
              or ${normalizedQuery} like
                '%' || a.normalized_alias || '%'
              or e.normalized_value % ${normalizedQuery}
              or a.normalized_alias % ${normalizedQuery}
            )
          )
        )
      order by
        score desc,
        de.max_chunk_mentions desc,
        de.mention_count desc,
        de.confidence desc,
        d.filename asc
      limit ${limit}`;

    if (!rows.length) {
      return empty(input.query, normalizedQuery);
    }

    // En yüksek skorlu entity seçilir. Aynı sorguda benzer birkaç entity
    // bulunabilse de tek entity endpoint'i yalnız en güçlü entity'yi döndürür.
    const first = rows[0];
    const entityRows = rows.filter((row) => row.entity_id === first.entity_id);

    const aliases = collectEntityAliases(entityRows);
    const documents = collectEntityDocuments(entityRows);
    const matchedEntity = {
      id: first.entity_id,
      fieldId: first.field_id,
      fieldKey: first.field_key,
      fieldLabel: first.field_label,
      canonicalValue: first.canonical_value,
    };

    return {
      queryType: 'ENTITY_SEARCH',
      query: input.query,
      normalizedQuery,
      matchedEntity,
      matchedAliases: aliases,
      retrievedDocuments: documents,
      sources: documents.map((document) => ({
        documentName: document.documentName,
        title: document.title,
        evidenceSnippet: document.evidenceSnippet,
        matchedAliases: aliases.map((alias) => alias.alias),
      })),
    };
  } finally {
    await client.close();
  }
}

/**
 * SQL sonuçlarındaki gerçek alias kayıtlarını tekilleştirir.
 *
 * Canonical değer alias tablosunda bulunmadığı sürece matchedAliases listesine
 * eklenmez; böylece canonical isim yanlışlıkla alias gibi gösterilmez.
 */
function collectEntityAliases(rows: EntitySearchRow[]): EntityAlias[] {
  const aliases = new Map<string, EntityAlias>();

  for (const row of rows) {
    if (
      !row.alias ||
      !row.normalized_alias ||
      row.normalized_alias === row.normalized_value
    ) {
      continue;
    }

    const candidate: EntityAlias = {
      alias: row.alias,
      normalizedAlias: row.normalized_alias,
      confidence: Number(row.alias_confidence ?? 0),
      source: normalizeAliasSource(row.alias_source),
    };
    const existing = aliases.get(candidate.normalizedAlias);

    if (!existing || candidate.confidence > existing.confidence) {
      aliases.set(candidate.normalizedAlias, candidate);
    }
  }

  return [...aliases.values()].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.alias.localeCompare(right.alias),
  );
}

/**
 * Aynı entity'nin belge bağlantılarını belge kimliği üzerinden tekilleştirir.
 *
 * Alias satırlarının çoğaltabileceği SQL kayıtları arasından mention sayısı ve
 * belge güveni daha yüksek olan bağlantıyı korur.
 */
function collectEntityDocuments(
  rows: EntitySearchRow[],
): CanonicalEntity['documents'] {
  const documents = new Map<string, CanonicalEntity['documents'][number]>();

  for (const row of rows) {
    const candidate: CanonicalEntity['documents'][number] = {
      documentId: row.document_id,
      documentName: slugify(row.filename.replace(/\.[^.]+$/, '')),
      title: row.title,
      markdownPath: '',
      mentionCount: Number(row.mention_count),
      maxChunkMentions: Number(row.max_chunk_mentions),
      evidenceSnippet: row.evidence_snippet,
      confidence: Number(row.document_confidence),
      chunkId: row.chunk_id ?? undefined,
      chunkIndex: row.chunk_index ?? undefined,
    };
    const existing = documents.get(row.document_id);

    if (
      !existing ||
      candidate.maxChunkMentions > existing.maxChunkMentions ||
      (candidate.maxChunkMentions === existing.maxChunkMentions &&
        candidate.mentionCount > existing.mentionCount) ||
      (candidate.maxChunkMentions === existing.maxChunkMentions &&
        candidate.mentionCount === existing.mentionCount &&
        candidate.confidence > existing.confidence)
    ) {
      documents.set(row.document_id, candidate);
    }
  }

  return [...documents.values()];
}

/**
 * Alias kaynağını EntityAlias sözleşmesindeki izinli değerlere dönüştürür.
 */
function normalizeAliasSource(source: string | null): EntityAlias['source'] {
  return ['LLM', 'FRONTMATTER', 'USER', 'IMPORT', 'REGEX'].includes(
    source ?? '',
  )
    ? (source as EntityAlias['source'])
    : 'REGEX';
}

/**
 * Boş veya eşleşmesiz entity araması için ortak sonuç nesnesi oluşturur.
 */
function empty(query: string, normalizedQuery: string): EntitySearchResult {
  return {
    queryType: 'ENTITY_SEARCH',
    query,
    normalizedQuery,
    matchedEntity: null,
    matchedAliases: [],
    retrievedDocuments: [],
    sources: [],
  };
}

/**
 * Entity aramasında anlam taşımayan genel soru kalıplarını sorgudan çıkarır.
 *
 * Tarih, sayı, belge kodu ve özel isimlere dokunulmaz.
 */
function extractEntityQuery(query: string) {
  return query
    .replace(/\bhangi\s+belgelerde\b/giu, ' ')
    .replace(
      /\b(?:geçiyor\s+mu|geciyor\s+mu|geçiyor|geciyor|listele)\b/giu,
      ' ',
    )
    .replace(/[?？]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Entity arama sonucunun limitini güvenli 1-100 aralığına sınırlar.
 */
function normalizeEntitySearchLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return 50;

  return Math.max(1, Math.min(100, Math.trunc(limit as number)));
}

/**
 * SQL uuid[] cast hatalarını önlemek için yalnız geçerli UUID değerlerini
 * tekilleştirerek döndürür.
 */
function uniqueValidUuidValues(values: string[] | undefined) {
  if (!values?.length) return [];

  return [
    ...new Set(
      values.filter((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          value,
        ),
      ),
    ),
  ];
}
