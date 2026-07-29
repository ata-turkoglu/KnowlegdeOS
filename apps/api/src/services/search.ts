import { normalizeForSearch } from "@knowledgeos/ingestion";
import { eq } from "drizzle-orm";
import { createDatabaseClient, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { type CanonicalEntity, type EntityAlias } from "./entities.js";
import { slugify } from "../lib/slug.js";
import type { MetadataFilters } from "./rag-core.js";

export type EntitySearchResult = {
  queryType: "ENTITY_SEARCH";
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
  retrievedDocuments: CanonicalEntity["documents"];
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    matchedAliases: string[];
  }>;
};

export async function searchEntityDocuments(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    query: string;
    filters?: MetadataFilters;
    entityIds?: string[];
  }
): Promise<EntitySearchResult> {
  const normalizedQuery = normalizeForSearch(extractEntityQuery(input.query));
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const [workspace] = await client.db.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.slug, slugify(input.workspaceSlug))).limit(1);
    if (!workspace || !normalizedQuery && !input.entityIds?.length) return empty(input.query, normalizedQuery);
    const allowedIds = input.filters?.allowedDocumentIds?.length ? input.filters.allowedDocumentIds : null;
    const entityIds = input.entityIds?.length ? input.entityIds : null;
    const rows = await client.queryClient<Array<{
      entity_id: string; document_id: string; field_id: string; field_key: string; field_label: string;
      canonical_value: string; normalized_value: string; alias: string; normalized_alias: string;
      confidence: number; source: string; filename: string; title: string; evidence_snippet: string;
      mention_count: number; max_chunk_mentions: number; chunk_id: string | null; chunk_index: number | null; score: number;
    }>>`
      select e.id as entity_id, d.id as document_id, f.id as field_id, f.key as field_key, f.label as field_label,
        e.canonical_value, e.normalized_value, coalesce(a.alias, e.canonical_value) as alias,
        coalesce(a.normalized_alias, e.normalized_value) as normalized_alias,
        coalesce(a.confidence, 1)::float8 as confidence, coalesce(a.source::text, 'FRONTMATTER') as source,
        d.filename, d.title, coalesce(best_chunk.evidence_snippet, de.evidence_snippet) as evidence_snippet,
        de.mention_count, de.max_chunk_mentions, best_chunk.chunk_id, best_chunk.chunk_index,
        case
          when e.id = any(coalesce(${entityIds}::uuid[], '{}'::uuid[])) then 120
          when e.normalized_value = ${normalizedQuery} or a.normalized_alias = ${normalizedQuery} then 100
          when ${normalizedQuery} like '%' || e.normalized_value || '%' or ${normalizedQuery} like '%' || a.normalized_alias || '%' then 90
          else greatest(similarity(e.normalized_value, ${normalizedQuery}), coalesce(similarity(a.normalized_alias, ${normalizedQuery}), 0)) * 80
        end::float8 as score
      from entities e
      join workspace_fields f on f.id = e.field_id
      left join entity_aliases a on a.entity_id = e.id
      join document_entities de on de.entity_id = e.id
      join documents d on d.id = de.document_id
      left join lateral (
        select ce.chunk_id, dc.chunk_index, ce.evidence_snippet
        from chunk_entities ce
        join document_chunks dc on dc.id = ce.chunk_id
        where ce.entity_id = e.id and dc.document_id = d.id
        order by ce.mention_count desc, dc.chunk_index asc
        limit 1
      ) best_chunk on true
      where f.workspace_id = ${workspace.id} and d.workspace_id = ${workspace.id} and d.status = 'INDEXED'
        and (${allowedIds}::uuid[] is null or d.id = any(${allowedIds}::uuid[]))
        and (
          e.id = any(coalesce(${entityIds}::uuid[], '{}'::uuid[]))
          or e.normalized_value = ${normalizedQuery}
          or a.normalized_alias = ${normalizedQuery}
          or ${normalizedQuery} like '%' || e.normalized_value || '%'
          or ${normalizedQuery} like '%' || a.normalized_alias || '%'
          or e.normalized_value % ${normalizedQuery}
          or a.normalized_alias % ${normalizedQuery}
        )
      order by score desc, de.max_chunk_mentions desc, de.mention_count desc, d.filename asc
      limit 50`;
    if (!rows.length) return empty(input.query, normalizedQuery);
    const first = rows[0];
    const entityRows = rows.filter((row) => row.entity_id === first.entity_id);
    const aliases: EntityAlias[] = [...new Map(entityRows.map((row) => [row.normalized_alias, {
      alias: row.alias,
      normalizedAlias: row.normalized_alias,
      confidence: Number(row.confidence),
      source: (["LLM", "FRONTMATTER", "USER", "IMPORT"].includes(row.source) ? row.source : "REGEX") as EntityAlias["source"]
    }])).values()];
    const documents = [...new Map(entityRows.map((row) => [row.document_id, {
      documentId: row.document_id,
      documentName: slugify(row.filename.replace(/\.[^.]+$/, "")),
      title: row.title,
      markdownPath: "",
      mentionCount: Number(row.mention_count),
      maxChunkMentions: Number(row.max_chunk_mentions),
      evidenceSnippet: row.evidence_snippet,
      confidence: Number(row.confidence),
      chunkId: row.chunk_id ?? undefined,
      chunkIndex: row.chunk_index ?? undefined
    }])).values()];
    const matchedEntity = {
      id: first.entity_id,
      fieldId: first.field_id,
      fieldKey: first.field_key,
      fieldLabel: first.field_label,
      canonicalValue: first.canonical_value
    };
    return {
      queryType: "ENTITY_SEARCH",
      query: input.query,
      normalizedQuery,
      matchedEntity,
      matchedAliases: aliases,
      retrievedDocuments: documents,
      sources: documents.map((document) => ({
        documentName: document.documentName,
        title: document.title,
        evidenceSnippet: document.evidenceSnippet,
        matchedAliases: aliases.map((alias) => alias.alias)
      }))
    };
  } finally {
    await client.close();
  }
}

function empty(query: string, normalizedQuery: string): EntitySearchResult {
  return {
    queryType: "ENTITY_SEARCH",
    query,
    normalizedQuery,
    matchedEntity: null,
    matchedAliases: [],
    retrievedDocuments: [],
    sources: []
  };
}

function extractEntityQuery(query: string) {
  return query
    .replace(/hangi belgelerde/giu, " ")
    .replace(/geçiyor mu|geciyor mu|geçiyor|geciyor|listele/giu, " ")
    .replace(/\?/g, " ")
    .trim();
}
