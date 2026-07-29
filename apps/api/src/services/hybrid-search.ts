import type { QueryType } from "@knowledgeos/shared";
import type { ApiConfig } from "../config/env.js";
import { searchSemanticDocuments, type SemanticSearchResult } from "./semantic-search.js";
import { searchEntityDocuments, type EntitySearchResult } from "./search.js";
import { getWorkspaceIngestionSettings } from "./workspace-settings.js";
import { analyzeQuery, type QueryAnalysis } from "./query-analyzer.js";
import { prepareQueryExecution, type ExecutionPlan } from "./execution-planner.js";

export type HybridSearchResult = {
  queryType: "HYBRID_SEARCH";
  query: string;
  analysis: QueryAnalysis;
  executionPlan: ExecutionPlan;
  entity: EntitySearchResult;
  semantic: SemanticSearchResult;
  documents: Array<{
    documentName: string;
    title: string;
    entityMatched: boolean;
    semanticScore: number | null;
    evidenceSnippet: string;
  }>;
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    sourceType: "ENTITY" | "SEMANTIC";
    score?: number;
  }>;
};

export async function searchHybridDocuments(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    query: string;
    limit?: number;
  }
): Promise<HybridSearchResult> {
  const settings = await getWorkspaceIngestionSettings(config, input.workspaceSlug);
  const analysis = await analyzeQuery(config, { workspaceSlug: input.workspaceSlug, query: input.query });
  const planning = await prepareQueryExecution(config, input.workspaceSlug, {
    ...analysis,
    queryType: "HYBRID_SEARCH",
    intent: analysis.intent === "COUNT" || analysis.intent === "EXISTS" ? "FIND" : analysis.intent
  }, input.limit ?? settings.semanticTopK);
  const executionPlan = planning.plan;
  const allowedDocumentIds = planning.documentIds;
  const [entity, semantic] = await Promise.all([
    searchEntityDocuments(config, { ...input, entityIds: analysis.matchedEntityIds, filters: { allowedDocumentIds } }),
    searchSemanticDocuments(config, { ...input, filters: { allowedDocumentIds }, limit: input.limit ?? settings.semanticTopK })
  ]);
  const byDocument = new Map<string, HybridSearchResult["documents"][number]>();

  for (const document of entity.retrievedDocuments) {
    byDocument.set(document.documentName, {
      documentName: document.documentName,
      title: document.title,
      entityMatched: true,
      semanticScore: null,
      evidenceSnippet: document.evidenceSnippet
    });
  }

  for (const result of semantic.results) {
    const existing = byDocument.get(result.documentName);

    if (existing) {
      existing.semanticScore = Math.max(existing.semanticScore ?? 0, result.score);
      continue;
    }

    byDocument.set(result.documentName, {
      documentName: result.documentName,
      title: result.title,
      entityMatched: false,
      semanticScore: result.score,
      evidenceSnippet: result.snippet
    });
  }

  const documents = [...byDocument.values()].sort((left, right) => {
    if (left.entityMatched !== right.entityMatched) {
      return left.entityMatched ? -1 : 1;
    }

    return (right.semanticScore ?? 0) - (left.semanticScore ?? 0);
  });

  return {
    queryType: "HYBRID_SEARCH",
    query: input.query,
    analysis,
    executionPlan,
    entity,
    semantic,
    documents,
    sources: [
      ...entity.sources.map((source) => ({
        documentName: source.documentName,
        title: source.title,
        evidenceSnippet: source.evidenceSnippet,
        sourceType: "ENTITY" as const
      })),
      ...semantic.sources.map((source) => ({
        documentName: source.documentName,
        title: source.title,
        evidenceSnippet: source.evidenceSnippet,
        sourceType: "SEMANTIC" as const,
        score: source.score
      }))
    ]
  };
}

export function answerFromHybrid(result: HybridSearchResult) {
  if (result.documents.length === 0) {
    return "Bu sorgu için ilgili belge bulunamadı.";
  }

  const documents = result.documents.map((document) => document.documentName).join(", ");
  const entityText = result.entity.matchedEntity
    ? `${result.entity.matchedEntity.canonicalValue} entity eşleşmesiyle`
    : "entity eşleşmesi olmadan";

  return `Hybrid arama ${entityText} şu belgeleri döndürdü: ${documents}.`;
}

export type RoutedSearchResult =
  | EntitySearchResult
  | SemanticSearchResult
  | HybridSearchResult;

export function queryTypeLabel(result: RoutedSearchResult): QueryType {
  return result.queryType;
}
