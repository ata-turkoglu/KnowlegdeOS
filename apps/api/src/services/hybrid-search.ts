import type { QueryType } from '@knowledgeos/shared';
import type { ApiConfig } from '../config/env.js';
import {
  searchSemanticDocuments,
  type SemanticSearchResult,
} from './semantic-search.js';
import { searchEntityDocuments, type EntitySearchResult } from './search.js';
import { getWorkspaceIngestionSettings } from './workspace-settings.js';
import {
  analyzeQuery,
  type QueryAnalysis,
  type QueryIntent,
} from './query-analyzer.js';
import {
  executionPlanHas,
  prepareQueryExecution,
  type ExecutionPlan,
} from './execution-planner.js';

export type HybridSearchResult = {
  queryType: 'HYBRID_SEARCH';
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
    sourceType: 'ENTITY' | 'SEMANTIC';
    score?: number;
  }>;
};

const directOnlyIntents = new Set<QueryIntent>([
  'COUNT',
  'EXISTS',
  'DISTINCT',
  'GROUP_BY',
  'FACET',
  'TIMELINE',
]);

/**
 * Entity ve semantic arama sonuçlarını aynı workspace ve metadata kapsamı
 * içinde çalıştırıp belge seviyesinde birleştirir.
 *
 * Hybrid endpoint doğrudan aggregation cevabı üretmediği için COUNT, EXISTS,
 * DISTINCT, GROUP_BY, FACET ve TIMELINE niyetleri retrieval amaçlı FIND
 * niyetine dönüştürülür. Orijinal kullanıcı sorgusu ve normalizasyon bilgisi
 * analysis içinde korunur.
 */
export async function searchHybridDocuments(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    query: string;
    limit?: number;
  },
): Promise<HybridSearchResult> {
  const settings = await getWorkspaceIngestionSettings(
    config,
    input.workspaceSlug,
  );
  const limit = normalizeSearchLimit(input.limit, settings.semanticTopK);

  const initialAnalysis = await analyzeQuery(config, {
    workspaceSlug: input.workspaceSlug,
    query: input.query,
  });

  // Hybrid search endpoint'i aggregation engine'i çalıştırmaz. Bu nedenle
  // deterministik-only niyetleri retrieval yapılabilecek FIND biçimine çeviririz.
  const analysis: QueryAnalysis = {
    ...initialAnalysis,
    queryType: 'HYBRID_SEARCH',
    intent: directOnlyIntents.has(initialAnalysis.intent)
      ? 'FIND'
      : initialAnalysis.intent,
  };

  const planning = await prepareQueryExecution(
    config,
    input.workspaceSlug,
    analysis,
    limit,
  );
  const executionPlan = planning.plan;
  const allowedDocumentIds = planning.documentIds;
  const filters = { allowedDocumentIds };

  // Normalizer veya analyzer tarafından hazırlanmış semantic sorgu bütün etkin
  // retriever'larda aynı biçimde kullanılır.
  const retrievalQuery = analysis.semanticQuery.trim() || input.query.trim();

  const emptyEntity = createEmptyEntityResult(input.query);
  const emptySemantic = createEmptySemanticResult(input.query);

  const [entity, semantic] = await Promise.all([
    executionPlanHas(executionPlan, 'ENTITY_LOOKUP')
      ? searchEntityDocuments(config, {
          workspaceSlug: input.workspaceSlug,
          query: retrievalQuery,
          limit,
          entityIds: analysis.matchedEntityIds,
          filters,
        })
      : Promise.resolve(emptyEntity),
    executionPlanHas(executionPlan, 'SEMANTIC_SEARCH')
      ? searchSemanticDocuments(config, {
          workspaceSlug: input.workspaceSlug,
          query: retrievalQuery,
          limit,
          filters,
        })
      : Promise.resolve(emptySemantic),
  ]);

  const byDocument = new Map<string, HybridSearchResult['documents'][number]>();

  for (const document of entity.retrievedDocuments) {
    const key = documentIdentity(document.documentId, document.documentName);

    byDocument.set(key, {
      documentName: document.documentName,
      title: document.title,
      entityMatched: true,
      semanticScore: null,
      evidenceSnippet: document.evidenceSnippet,
    });
  }

  for (const result of semantic.results) {
    const key = documentIdentity(result.documentId, result.documentName);
    const existing = byDocument.get(key);

    if (existing) {
      existing.semanticScore = Math.max(
        existing.semanticScore ?? 0,
        result.score,
      );

      // Entity kanıtı boşsa semantic snippet belge kartını tamamlar.
      if (!existing.evidenceSnippet.trim()) {
        existing.evidenceSnippet = result.snippet;
      }
      continue;
    }

    byDocument.set(key, {
      documentName: result.documentName,
      title: result.title,
      entityMatched: false,
      semanticScore: result.score,
      evidenceSnippet: result.snippet,
    });
  }

  const documents = [...byDocument.values()]
    .sort(compareHybridDocuments)
    .slice(0, limit);

  return {
    queryType: 'HYBRID_SEARCH',
    query: input.query,
    analysis,
    executionPlan,
    entity,
    semantic,
    documents,
    sources: dedupeHybridSources([
      ...entity.sources.map((source) => ({
        documentName: source.documentName,
        title: source.title,
        evidenceSnippet: source.evidenceSnippet,
        sourceType: 'ENTITY' as const,
      })),
      ...semantic.sources.map((source) => ({
        documentName: source.documentName,
        title: source.title,
        evidenceSnippet: source.evidenceSnippet,
        sourceType: 'SEMANTIC' as const,
        score: source.score,
      })),
    ]),
  };
}

/**
 * Hybrid arama sonucundan kullanıcıya gösterilecek kısa ve deterministik
 * açıklamayı üretir.
 */
export function answerFromHybrid(result: HybridSearchResult) {
  if (result.documents.length === 0) {
    return 'Bu sorgu için ilgili belge bulunamadı.';
  }

  const documents = result.documents
    .map((document) => document.documentName)
    .join(', ');
  const entityText = result.entity.matchedEntity
    ? `${result.entity.matchedEntity.canonicalValue} entity eşleşmesiyle`
    : 'entity eşleşmesi olmadan';

  return `Hybrid arama ${entityText} şu belgeleri döndürdü: ${documents}.`;
}

export type RoutedSearchResult =
  | EntitySearchResult
  | SemanticSearchResult
  | HybridSearchResult;

/**
 * Farklı search sonuç tiplerinden ortak QueryType değerini döndürür.
 */
export function queryTypeLabel(result: RoutedSearchResult): QueryType {
  return result.queryType;
}

/**
 * Kullanıcı veya workspace ayarından gelen sonuç limitini güvenli aralığa
 * sınırlar.
 */
function normalizeSearchLimit(requested: number | undefined, fallback: number) {
  const candidate = requested ?? fallback;
  if (!Number.isFinite(candidate)) return 20;

  return Math.max(1, Math.min(100, Math.trunc(candidate)));
}

/**
 * Entity retriever çalıştırılmadığında tip güvenli boş sonuç oluşturur.
 */
function createEmptyEntityResult(query: string): EntitySearchResult {
  return {
    queryType: 'ENTITY_SEARCH',
    query,
    normalizedQuery: '',
    matchedEntity: null,
    matchedAliases: [],
    retrievedDocuments: [],
    sources: [],
  };
}

/**
 * Semantic retriever çalıştırılmadığında tip güvenli boş sonuç oluşturur.
 */
function createEmptySemanticResult(query: string): SemanticSearchResult {
  return {
    queryType: 'SEMANTIC_SEARCH',
    query,
    embeddingModel: '',
    results: [],
    sources: [],
  };
}

/**
 * Aynı dosya adına sahip farklı belgelerin yanlışlıkla birleşmesini önlemek
 * için mümkünse documentId, yoksa belge adı üzerinden kararlı anahtar üretir.
 */
function documentIdentity(
  documentId: string | undefined,
  documentName: string,
) {
  return documentId ? `id:${documentId}` : `name:${documentName}`;
}

/**
 * Entity eşleşmesini semantic skordan önceleyen kararlı belge sıralaması yapar.
 */
function compareHybridDocuments(
  left: HybridSearchResult['documents'][number],
  right: HybridSearchResult['documents'][number],
) {
  if (left.entityMatched !== right.entityMatched) {
    return left.entityMatched ? -1 : 1;
  }

  return (
    (right.semanticScore ?? 0) - (left.semanticScore ?? 0) ||
    left.documentName.localeCompare(right.documentName)
  );
}

/**
 * Aynı retriever, belge ve snippet kombinasyonundaki kaynak tekrarlarını
 * temizler; semantic tekrarlarda en yüksek skoru korur.
 */
function dedupeHybridSources(sources: HybridSearchResult['sources']) {
  const deduped = new Map<string, HybridSearchResult['sources'][number]>();

  for (const source of sources) {
    const key = [
      source.sourceType,
      source.documentName,
      source.evidenceSnippet,
    ].join(':');
    const existing = deduped.get(key);

    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) {
      deduped.set(key, source);
    }
  }

  return [...deduped.values()];
}
