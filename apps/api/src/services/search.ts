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
    type: CanonicalEntity["type"];
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
  }
): Promise<EntitySearchResult> {
  const normalizedQuery = normalizeForSearch(extractEntityQuery(input.query));
  const client = createDatabaseClient(config.databaseUrl);
  const best = await (async () => {
    try {
      const [workspace] = await client.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slugify(input.workspaceSlug))).limit(1);
      if (!workspace || !normalizedQuery) return null;
      const rows = await client.queryClient<{ entity_id: string; document_id: string; type: CanonicalEntity["type"]; canonical_value: string; normalized_value: string; alias: string; normalized_alias: string; confidence: number; source: string; filename: string; title: string; evidence_snippet: string; occurrence_count: number; score: number }[]>`
        select e.id as entity_id, d.id as document_id, e.type, e.canonical_value, e.normalized_value, coalesce(a.alias, e.canonical_value) as alias, coalesce(a.normalized_alias, e.normalized_value) as normalized_alias, coalesce(a.confidence, 1)::float8 as confidence, coalesce(a.source::text, 'REGEX') as source, d.filename, d.title, de.evidence_snippet, de.occurrence_count,
          case when e.normalized_value = ${normalizedQuery} or a.normalized_alias = ${normalizedQuery} then 100 when e.normalized_value like ${`%${normalizedQuery}%`} or a.normalized_alias like ${`%${normalizedQuery}%`} then 85 else 0 end as score
        from entities e left join entity_aliases a on a.entity_id = e.id join document_entities de on de.entity_id = e.id join documents d on d.id = de.document_id
        where e.workspace_id = ${workspace.id} and d.workspace_id = ${workspace.id} and d.status = 'INDEXED'
          and (${input.filters?.year ?? null}::text is null or extract(year from d.document_date)::text = ${input.filters?.year ?? null})
          and (${input.filters?.date ?? null}::date is null or d.document_date = ${input.filters?.date ?? null}::date)
          and (${input.filters?.documentType ?? null}::text is null or d.document_type ilike ${input.filters?.documentType ? `%${input.filters.documentType}%` : null})
          and (e.normalized_value = ${normalizedQuery} or a.normalized_alias = ${normalizedQuery} or e.normalized_value like ${`%${normalizedQuery}%`} or a.normalized_alias like ${`%${normalizedQuery}%`})
        order by score desc, de.occurrence_count desc, d.filename asc limit 50`;
      if (!rows.length) return null;
      const first = rows[0]; const aliases: EntityAlias[] = [...new Map(rows.filter((row) => row.entity_id === first.entity_id).map((row) => [row.normalized_alias, { alias: row.alias, normalizedAlias: row.normalized_alias, confidence: Number(row.confidence), source: (row.source === "IMPORT" ? "IMPORT" : "REGEX") as EntityAlias["source"] }])).values()];
      return { entity: { id: first.entity_id, type: first.type, canonicalValue: first.canonical_value }, aliases, documents: rows.filter((row) => row.entity_id === first.entity_id).map((row) => ({ documentId: row.document_id, documentName: slugify(row.filename.replace(/\.[^.]+$/, "")), title: row.title, markdownPath: "", occurrenceCount: Number(row.occurrence_count), evidenceSnippet: row.evidence_snippet, confidence: 1 })) };
    } finally { await client.close(); }
  })();

  if (!best) {
    return {
      queryType: "ENTITY_SEARCH",
      query: input.query,
      normalizedQuery,
      matchedEntity: null,
      matchedAliases: [],
      retrievedDocuments: [],
      sources: []
    };
  }

  return {
    queryType: "ENTITY_SEARCH",
    query: input.query,
    normalizedQuery,
    matchedEntity: {
      id: best.entity.id, type: best.entity.type, canonicalValue: best.entity.canonicalValue
    },
    matchedAliases: best.aliases,
    retrievedDocuments: best.documents,
    sources: best.documents.map((document) => ({
      documentName: document.documentName,
      title: document.title,
      evidenceSnippet: document.evidenceSnippet,
      matchedAliases: best.aliases.map((alias) => alias.alias)
    }))
  };
}

function extractEntityQuery(query: string) {
  return query
    .replace(/hangi belgelerde/giu, " ")
    .replace(/geçiyor mu/giu, " ")
    .replace(/geciyor mu/giu, " ")
    .replace(/geçiyor/giu, " ")
    .replace(/geciyor/giu, " ")
    .replace(/listele/giu, " ")
    .replace(/\?/g, " ")
    .trim();
}

function scoreEntity(entity: CanonicalEntity, normalizedQuery: string) {
  const aliasScores = entity.aliases.map((alias) =>
    scoreAlias(alias.normalizedAlias, normalizedQuery)
  );

  return Math.max(scoreAlias(entity.normalizedValue, normalizedQuery), ...aliasScores);
}

function matchingAliases(entity: CanonicalEntity, normalizedQuery: string) {
  const aliases = entity.aliases.filter(
    (alias) => scoreAlias(alias.normalizedAlias, normalizedQuery) > 0
  );

  if (aliases.length > 0) {
    return aliases;
  }

  return [
    {
      alias: entity.canonicalValue,
      normalizedAlias: entity.normalizedValue,
      confidence: 1,
      source: "REGEX" as const
    }
  ];
}

function scoreAlias(normalizedAlias: string, normalizedQuery: string) {
  if (!normalizedAlias || !normalizedQuery) {
    return 0;
  }

  if (normalizedAlias === normalizedQuery) {
    return 100;
  }

  if (normalizedAlias.includes(normalizedQuery) || normalizedQuery.includes(normalizedAlias)) {
    return 85;
  }

  const aliasParts = normalizedAlias.split(" ");
  const queryParts = normalizedQuery.split(" ");
  const aliasSurname = aliasParts.at(-1) ?? normalizedAlias;
  const querySurname = queryParts.at(-1) ?? normalizedQuery;
  const aliasInitial = aliasParts[0]?.[0];
  const queryInitial = queryParts[0]?.[0];

  if (aliasInitial && queryInitial && aliasInitial === queryInitial) {
    const distance = levenshteinDistance(aliasSurname, querySurname);

    if (distance <= 2) {
      return 70 - distance;
    }
  }

  return 0;
}

function levenshteinDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );

  for (let row = 0; row <= left.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= right.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[left.length][right.length];
}
