import { classifyQuery } from "@knowledgeos/search";
import type { QueryType } from "@knowledgeos/shared";
import type { ApiConfig } from "../config/env.js";
import { answerFromHybrid, searchHybridDocuments } from "./hybrid-search.js";
import { searchSemanticDocuments } from "./semantic-search.js";
import { searchEntityDocuments, type EntitySearchResult } from "./search.js";

export type ChatResponse = {
  queryType: QueryType;
  answer: string;
  matchedEntity: EntitySearchResult["matchedEntity"];
  matchedAliases: EntitySearchResult["matchedAliases"];
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    matchedAliases?: string[];
    sourceType?: "ENTITY" | "SEMANTIC";
    score?: number;
  }>;
};

export async function answerChat(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    message: string;
  }
): Promise<ChatResponse> {
  const queryType = classifyQuery(input.message);

  if (queryType === "ENTITY_SEARCH") {
    const result = await searchEntityDocuments(config, {
      workspaceSlug: input.workspaceSlug,
      query: input.message
    });

    return {
      queryType,
      answer: entitySearchAnswer(result),
      matchedEntity: result.matchedEntity,
      matchedAliases: result.matchedAliases,
      sources: result.sources
    };
  }

  if (queryType === "HYBRID_SEARCH") {
    const result = await searchHybridDocuments(config, {
      workspaceSlug: input.workspaceSlug,
      query: input.message
    });

    return {
      queryType,
      answer: answerFromHybrid(result),
      matchedEntity: result.entity.matchedEntity,
      matchedAliases: result.entity.matchedAliases,
      sources: result.sources
    };
  }

  if (queryType === "SEMANTIC_SEARCH") {
    const result = await searchSemanticDocuments(config, {
      workspaceSlug: input.workspaceSlug,
      query: input.message
    });

    return {
      queryType,
      answer:
        result.results.length > 0
          ? `Semantic arama en ilgili belge olarak ${result.results[0].documentName} sonucunu buldu.`
          : "Semantic arama için ilgili belge bulunamadı.",
      matchedEntity: null,
      matchedAliases: [],
      sources: result.sources.map((source) => ({
        ...source,
        sourceType: "SEMANTIC" as const
      }))
    };
  }

  return {
    queryType,
    answer:
      "Bu soru tipi için chat cevabı henüz MVP kapsamında uygulanmadı. Şu an kesin entity arama soruları destekleniyor.",
    matchedEntity: null,
    matchedAliases: [],
    sources: []
  };
}

function entitySearchAnswer(result: EntitySearchResult) {
  if (!result.matchedEntity) {
    return "Bu entity için eşleşen belge bulunamadı.";
  }

  if (result.retrievedDocuments.length === 0) {
    return `${result.matchedEntity.canonicalValue} için kaynak belge bulunamadı.`;
  }

  const documents = result.retrievedDocuments
    .map((document) => document.documentName)
    .join(", ");

  return `${result.matchedEntity.canonicalValue} şu belgelerde geçiyor: ${documents}.`;
}
