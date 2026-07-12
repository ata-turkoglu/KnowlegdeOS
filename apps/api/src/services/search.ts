import { normalizeForSearch } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { readEntityIndex, type CanonicalEntity, type EntityAlias } from "./entities.js";

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
  }
): Promise<EntitySearchResult> {
  const normalizedQuery = normalizeForSearch(extractEntityQuery(input.query));
  const index = await readEntityIndex(config, input.workspaceSlug);
  const scored = index.entities
    .map((entity) => ({
      entity,
      score: scoreEntity(entity, normalizedQuery),
      aliases: matchingAliases(entity, normalizedQuery)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

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
      id: best.entity.id,
      type: best.entity.type,
      canonicalValue: best.entity.canonicalValue
    },
    matchedAliases: best.aliases,
    retrievedDocuments: best.entity.documents,
    sources: best.entity.documents.map((document) => ({
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
