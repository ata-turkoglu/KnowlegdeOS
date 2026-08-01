import { and, count, eq, isNotNull } from 'drizzle-orm';
import {
  createDatabaseClient,
  documentChunks,
  documents,
  workspaces,
} from '@knowledgeos/database';
import type { ApiConfig } from '../config/env.js';
import { slugify } from '../lib/slug.js';
import { selectedEmbeddingModel } from './ai-providers.js';
import {
  resolveAnalysisDocumentIds,
  type QueryAnalysis,
  type QueryFilter,
  type QueryIntent,
} from './query-analyzer.js';

export type ExecutionOperation =
  | 'FILTER'
  | 'ENTITY_LOOKUP'
  | 'LEXICAL_SEARCH'
  | 'SEMANTIC_SEARCH'
  | 'RRF'
  | 'RERANK'
  | 'SORT'
  | 'LIMIT'
  | 'COUNT'
  | 'EXISTS'
  | 'DISTINCT'
  | 'GROUP_BY'
  | 'FACET'
  | 'ANSWER';

export type ExecutionNode = {
  id: string;
  op: ExecutionOperation;
  dependsOn: string[];
  parallelGroup?: 'RETRIEVAL';
  limit?: number;
  filters?: QueryFilter[];
  entityIds?: string[];
  query?: string;
  fieldId?: string;
  fieldKey?: string;
  direction?: 'ASC' | 'DESC';
  answerMode?: 'DIRECT' | 'GENERATIVE' | 'SUMMARY' | 'COMPARISON';
};

export type PlannerCapabilities = {
  metadataFilter: boolean;
  entityLookup: boolean;
  lexicalSearch: boolean;
  semanticSearch: boolean;
  directAggregation: boolean;
};

export type PlannerEstimates = {
  totalDocuments: number;
  filteredDocuments: number;
  selectivity: number;
  expectedRows: number;
};

export type ExecutionPlan = {
  version: 2;
  intent: QueryIntent;
  strategy: 'DETERMINISTIC' | 'RETRIEVAL' | 'GENERATIVE';
  nodes: ExecutionNode[];
  capabilities: PlannerCapabilities;
  estimates: PlannerEstimates;
  requiresLlmAnswer: boolean;
  estimatedCost: 'LOW' | 'MEDIUM' | 'HIGH';
};

type PlannerContext = Partial<PlannerCapabilities & PlannerEstimates>;

const defaultCapabilities: PlannerCapabilities = {
  metadataFilter: true,
  entityLookup: true,
  lexicalSearch: true,
  semanticSearch: true,
  directAggregation: true,
};

const defaultEstimates: PlannerEstimates = {
  totalDocuments: 0,
  filteredDocuments: 0,
  selectivity: 1,
  expectedRows: 20,
};

/**
 * Sorgu analizini çalıştırılabilir plana dönüştürür.
 * Veritabanı hazırlık ayrıntılarını çağırandan gizleyerek yalnızca planı döndürür.
 */
export async function planQueryExecution(
  config: ApiConfig,
  workspaceSlugInput: string,
  analysis: QueryAnalysis,
  limit = 20,
) {
  return (
    await prepareQueryExecution(config, workspaceSlugInput, analysis, limit)
  ).plan;
}

/**
 * Workspace ve indeks durumunu okuyarak planlayıcı için gerçekçi yetenek ve satır tahminleri üretir.
 * Ayrıca analizdeki kesin filtrelere uyan belge kimliklerini yürütücüye iletir.
 */
export async function prepareQueryExecution(
  config: ApiConfig,
  workspaceSlugInput: string,
  analysis: QueryAnalysis,
  limit = 20,
) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const embeddingModel = selectedEmbeddingModel(config);
    const [workspace] = await client.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);
    if (!workspace)
      return {
        plan: buildExecutionPlan(analysis, limit, {
          totalDocuments: 0,
          filteredDocuments: 0,
          expectedRows: 0,
          selectivity: 0,
          semanticSearch: false,
        }),
        documentIds: [] as string[] | undefined,
      };
    const [[total], [embedded], constrainedIds] = await Promise.all([
      client.db
        .select({ value: count(documents.id) })
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, workspace.id),
            eq(documents.status, 'INDEXED'),
          ),
        ),
      client.db
        .select({ value: count(documentChunks.id) })
        .from(documentChunks)
        .innerJoin(documents, eq(documents.id, documentChunks.documentId))
        .where(
          and(
            eq(documents.workspaceId, workspace.id),
            eq(documents.status, 'INDEXED'),
            eq(documents.embeddingModel, embeddingModel),
            isNotNull(documentChunks.embedding),
          ),
        ),
      resolveAnalysisDocumentIds(config, slug, analysis),
    ]);
    const totalDocuments = Number(total?.value ?? 0);
    const filteredDocuments =
      constrainedIds === undefined ? totalDocuments : constrainedIds.length;
    const boundedLimit = normalizeLimit(limit);
    return {
      plan: buildExecutionPlan(analysis, boundedLimit, {
        totalDocuments,
        filteredDocuments,
        // expectedRows filtreye uyan toplam belge sayısı değil, planın işlemesi beklenen üst sınırdır.
        expectedRows: Math.min(filteredDocuments, boundedLimit),
        selectivity: totalDocuments ? filteredDocuments / totalDocuments : 0,
        semanticSearch: Number(embedded?.value ?? 0) > 0,
      }),
      documentIds: constrainedIds,
    };
  } finally {
    await client.close();
  }
}

/**
 * Analizin niyetine, filtrelerine ve indeks yeteneklerine göre deterministik veya üretken yürütme grafiği kurar.
 * Kesin metadata/entity kısıtları küçük bir sonuç kümesi üretiyorsa gereksiz retrieval adımlarını eklemez.
 */
export function buildExecutionPlan(
  analysis: QueryAnalysis,
  limit = 20,
  context: PlannerContext = {},
): ExecutionPlan {
  const capabilities = { ...defaultCapabilities, ...pickCapabilities(context) };
  const estimates = { ...defaultEstimates, ...pickEstimates(context) };
  const boundedLimit = normalizeLimit(limit);
  const filter: ExecutionNode = {
    id: 'filter',
    op: 'FILTER',
    dependsOn: [],
    filters: analysis.filters,
  };
  const entityNeeded =
    capabilities.entityLookup &&
    (analysis.matchedEntityIds.length > 0 ||
      analysis.queryType === 'ENTITY_SEARCH');
  const entity: ExecutionNode[] = entityNeeded
    ? [
        {
          id: 'entity',
          op: 'ENTITY_LOOKUP',
          dependsOn: ['filter'],
          entityIds: analysis.matchedEntityIds,
        },
      ]
    : [];
  const aggregateDependency = entityNeeded ? 'entity' : 'filter';

  if (
    capabilities.directAggregation &&
    analysis.dateSearchMode !== 'CONTENT_DATE' &&
    ['COUNT', 'EXISTS', 'DISTINCT', 'GROUP_BY', 'FACET'].includes(
      analysis.intent,
    )
  ) {
    const aggregateOp = analysis.intent as
      | 'COUNT'
      | 'EXISTS'
      | 'DISTINCT'
      | 'GROUP_BY'
      | 'FACET';
    const aggregate: ExecutionNode = {
      id: 'aggregate',
      op: aggregateOp,
      dependsOn: [aggregateDependency],
      fieldId: analysis.aggregationField?.fieldId,
      fieldKey: analysis.aggregationField?.fieldKey,
      limit: boundedLimit,
    };
    return validateExecutionPlan({
      version: 2,
      intent: analysis.intent,
      strategy: 'DETERMINISTIC',
      nodes: [
        filter,
        ...entity,
        aggregate,
        {
          id: 'answer',
          op: 'ANSWER',
          dependsOn: ['aggregate'],
          answerMode: 'DIRECT',
        },
      ],
      capabilities,
      estimates,
      requiresLlmAnswer: false,
      estimatedCost: estimates.filteredDocuments > 10_000 ? 'MEDIUM' : 'LOW',
    });
  }

  if (analysis.intent === 'TIMELINE') {
    const sort: ExecutionNode = {
      id: 'sort',
      op: 'SORT',
      dependsOn: [aggregateDependency],
      fieldId: analysis.aggregationField?.fieldId,
      fieldKey: analysis.aggregationField?.fieldKey ?? 'date',
      direction: /\b(en yeni|latest|newest)\b/u.test(
        analysis.originalQuery.toLocaleLowerCase('tr-TR'),
      )
        ? 'DESC'
        : 'ASC',
      limit: boundedLimit,
    };
    return validateExecutionPlan({
      version: 2,
      intent: analysis.intent,
      strategy: 'DETERMINISTIC',
      nodes: [
        filter,
        ...entity,
        sort,
        { id: 'limit', op: 'LIMIT', dependsOn: ['sort'], limit: boundedLimit },
        {
          id: 'answer',
          op: 'ANSWER',
          dependsOn: ['limit'],
          answerMode: 'DIRECT',
        },
      ],
      capabilities,
      estimates,
      requiresLlmAnswer: false,
      estimatedCost: 'LOW',
    });
  }

  const nodes: ExecutionNode[] = [filter, ...entity];
  const retrieval: ExecutionNode[] = [];
  const retrievalDependency = aggregateDependency;
  const hasExactConstraints =
    analysis.filters.length > 0 || analysis.matchedEntityIds.length > 0;
  const constrainedResultSufficient =
    analysis.intent === 'FIND' &&
    hasExactConstraints &&
    estimates.filteredDocuments > 0 &&
    estimates.filteredDocuments <= boundedLimit;

  // Lexical aramada özgün sorguyu korumak tarih, belge kodu ve özel adların kaybolmasını önler.
  if (capabilities.lexicalSearch && !constrainedResultSufficient) {
    retrieval.push({
      id: 'lexical',
      op: 'LEXICAL_SEARCH',
      dependsOn: [retrievalDependency],
      parallelGroup: 'RETRIEVAL',
      query: analysis.originalQuery,
      limit: boundedLimit,
    });
  }

  const semanticUseful =
    capabilities.semanticSearch &&
    !constrainedResultSufficient &&
    (analysis.dateSearchMode === 'CONTENT_DATE' ||
      analysis.queryType !== 'ENTITY_SEARCH' ||
      ['SUMMARIZE', 'COMPARE'].includes(analysis.intent));
  if (semanticUseful) {
    retrieval.push({
      id: 'semantic',
      op: 'SEMANTIC_SEARCH',
      dependsOn: [retrievalDependency],
      parallelGroup: 'RETRIEVAL',
      query: analysis.semanticQuery || analysis.originalQuery,
      limit: boundedLimit,
    });
  }

  nodes.push(...retrieval);
  const terminalIds = retrieval.map((node) => node.id);
  let answerDependencies = terminalIds.length
    ? terminalIds
    : [retrievalDependency];
  const expectedCandidates = estimateCandidateRows(
    estimates.filteredDocuments,
    boundedLimit,
    terminalIds.length,
  );

  if (terminalIds.length > 1 && expectedCandidates > 3) {
    nodes.push({
      id: 'fusion',
      op: 'RRF',
      dependsOn: terminalIds,
      limit: boundedLimit,
    });
    answerDependencies = ['fusion'];
  }

  const hasLockedRuleAnchors = analysis.filters.some(
    (filter) => filter.locked && filter.source === 'RULE',
  );
  const shouldRerank =
    answerDependencies[0] === 'fusion' &&
    expectedCandidates > 8 &&
    !hasLockedRuleAnchors;
  if (shouldRerank) {
    nodes.push({
      id: 'rerank',
      op: 'RERANK',
      dependsOn: answerDependencies,
      limit: boundedLimit,
    });
    answerDependencies = ['rerank'];
  }

  nodes.push({
    id: 'answer',
    op: 'ANSWER',
    dependsOn: answerDependencies,
    answerMode:
      analysis.intent === 'SUMMARIZE'
        ? 'SUMMARY'
        : analysis.intent === 'COMPARE'
          ? 'COMPARISON'
          : 'GENERATIVE',
  });

  return validateExecutionPlan({
    version: 2,
    intent: analysis.intent,
    strategy: 'GENERATIVE',
    nodes,
    capabilities,
    estimates: {
      ...estimates,
      expectedRows: Math.min(expectedCandidates, boundedLimit),
    },
    requiresLlmAnswer: true,
    estimatedCost: estimatePlanCost({
      semanticSearch: semanticUseful,
      rerank: shouldRerank,
      filteredDocuments: estimates.filteredDocuments,
    }),
  });
}

/**
 * Planın düğüm sınırlarını, bağımlılıklarını, limitlerini ve döngü içermediğini doğrular.
 * Geçersiz bir planın yürütücüye ulaşmasını engeller.
 */
export function validateExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  if (plan.version !== 2 || plan.nodes.length < 2 || plan.nodes.length > 16)
    throw new Error('Invalid execution plan.');
  const ids = new Set(plan.nodes.map((node) => node.id));
  if (ids.size !== plan.nodes.length || plan.nodes.at(-1)?.op !== 'ANSWER')
    throw new Error('Execution plan boundaries are invalid.');
  for (const node of plan.nodes) {
    if (
      node.dependsOn.some(
        (dependency) => !ids.has(dependency) || dependency === node.id,
      )
    )
      throw new Error('Execution plan dependency is invalid.');
    if (
      node.limit !== undefined &&
      (!Number.isInteger(node.limit) || node.limit < 1 || node.limit > 100)
    )
      throw new Error('Execution plan limit is invalid.');
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('Execution plan contains a cycle.');
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    active.delete(id);
    visited.add(id);
  };
  for (const node of plan.nodes) visit(node.id);
  const direct = plan.nodes.some((node) =>
    ['COUNT', 'EXISTS', 'DISTINCT', 'GROUP_BY', 'FACET', 'SORT'].includes(
      node.op,
    ),
  );
  if (direct && plan.requiresLlmAnswer)
    throw new Error('Execution plan strategy is inconsistent.');
  return plan;
}

/** Belirli bir operasyonun planda bulunup bulunmadığını kontrol eder. */
export function executionPlanHas(plan: ExecutionPlan, op: ExecutionOperation) {
  return plan.nodes.some((node) => node.op === op);
}

function normalizeLimit(limit: number) {
  return Math.max(1, Math.min(100, Math.trunc(limit || 20)));
}

function estimateCandidateRows(
  filteredDocuments: number,
  limit: number,
  retrievalBranchCount: number,
) {
  if (retrievalBranchCount === 0) return Math.min(filteredDocuments, limit);
  return Math.min(filteredDocuments, limit * retrievalBranchCount);
}

function estimatePlanCost(input: {
  semanticSearch: boolean;
  rerank: boolean;
  filteredDocuments: number;
}): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (
    input.rerank ||
    (input.semanticSearch && input.filteredDocuments > 10_000)
  )
    return 'HIGH';
  if (input.semanticSearch || input.filteredDocuments > 10_000) return 'MEDIUM';
  return 'LOW';
}

function pickCapabilities(
  context: PlannerContext,
): Partial<PlannerCapabilities> {
  return Object.fromEntries(
    Object.entries(context).filter(([key]) => key in defaultCapabilities),
  ) as Partial<PlannerCapabilities>;
}

function pickEstimates(context: PlannerContext): Partial<PlannerEstimates> {
  return Object.fromEntries(
    Object.entries(context).filter(([key]) => key in defaultEstimates),
  ) as Partial<PlannerEstimates>;
}
