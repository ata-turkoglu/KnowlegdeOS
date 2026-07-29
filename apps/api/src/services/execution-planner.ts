import { and, count, eq, isNotNull } from "drizzle-orm";
import { createDatabaseClient, documentChunks, documents, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { selectedEmbeddingModel } from "./ai-providers.js";
import { resolveAnalysisDocumentIds, type QueryAnalysis, type QueryFilter, type QueryIntent } from "./query-analyzer.js";

export type ExecutionOperation =
  | "FILTER" | "ENTITY_LOOKUP" | "LEXICAL_SEARCH" | "SEMANTIC_SEARCH"
  | "RRF" | "RERANK" | "SORT" | "LIMIT"
  | "COUNT" | "EXISTS" | "DISTINCT" | "GROUP_BY" | "FACET" | "ANSWER";

export type ExecutionNode = {
  id: string;
  op: ExecutionOperation;
  dependsOn: string[];
  parallelGroup?: "RETRIEVAL";
  limit?: number;
  filters?: QueryFilter[];
  entityIds?: string[];
  query?: string;
  fieldId?: string;
  fieldKey?: string;
  direction?: "ASC" | "DESC";
  answerMode?: "DIRECT" | "GENERATIVE" | "SUMMARY" | "COMPARISON";
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
  strategy: "DETERMINISTIC" | "RETRIEVAL" | "GENERATIVE";
  nodes: ExecutionNode[];
  capabilities: PlannerCapabilities;
  estimates: PlannerEstimates;
  requiresLlmAnswer: boolean;
  estimatedCost: "LOW" | "MEDIUM" | "HIGH";
};

type PlannerContext = Partial<PlannerCapabilities & PlannerEstimates>;

const defaultCapabilities: PlannerCapabilities = {
  metadataFilter: true,
  entityLookup: true,
  lexicalSearch: true,
  semanticSearch: true,
  directAggregation: true
};

const defaultEstimates: PlannerEstimates = {
  totalDocuments: 0,
  filteredDocuments: 0,
  selectivity: 1,
  expectedRows: 20
};

export async function planQueryExecution(
  config: ApiConfig,
  workspaceSlugInput: string,
  analysis: QueryAnalysis,
  limit = 20
) {
  return (await prepareQueryExecution(config, workspaceSlugInput, analysis, limit)).plan;
}

export async function prepareQueryExecution(
  config: ApiConfig,
  workspaceSlugInput: string,
  analysis: QueryAnalysis,
  limit = 20
) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const embeddingModel = selectedEmbeddingModel(config);
    const [workspace] = await client.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return {
      plan: buildExecutionPlan(analysis, limit, { totalDocuments: 0, filteredDocuments: 0, expectedRows: 0, selectivity: 0, semanticSearch: false }),
      documentIds: [] as string[] | undefined
    };
    const [[total], [embedded], constrainedIds] = await Promise.all([
      client.db.select({ value: count(documents.id) }).from(documents).where(and(eq(documents.workspaceId, workspace.id), eq(documents.status, "INDEXED"))),
      client.db.select({ value: count(documentChunks.id) }).from(documentChunks)
        .innerJoin(documents, eq(documents.id, documentChunks.documentId))
        .where(and(eq(documents.workspaceId, workspace.id), eq(documents.status, "INDEXED"), eq(documents.embeddingModel, embeddingModel), isNotNull(documentChunks.embedding))),
      resolveAnalysisDocumentIds(config, slug, analysis)
    ]);
    const totalDocuments = Number(total?.value ?? 0);
    const filteredDocuments = constrainedIds === undefined ? totalDocuments : constrainedIds.length;
    return {
      plan: buildExecutionPlan(analysis, limit, {
        totalDocuments,
        filteredDocuments,
        expectedRows: filteredDocuments,
        selectivity: totalDocuments ? filteredDocuments / totalDocuments : 0,
        semanticSearch: Number(embedded?.value ?? 0) > 0
      }),
      documentIds: constrainedIds
    };
  } finally {
    await client.close();
  }
}

export function buildExecutionPlan(analysis: QueryAnalysis, limit = 20, context: PlannerContext = {}): ExecutionPlan {
  const capabilities = { ...defaultCapabilities, ...pickCapabilities(context) };
  const estimates = { ...defaultEstimates, ...pickEstimates(context) };
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit || 20)));
  const filter: ExecutionNode = { id: "filter", op: "FILTER", dependsOn: [], filters: analysis.filters };
  const entityNeeded = capabilities.entityLookup && (analysis.matchedEntityIds.length > 0 || analysis.queryType === "ENTITY_SEARCH");
  const entity: ExecutionNode[] = entityNeeded
    ? [{ id: "entity", op: "ENTITY_LOOKUP", dependsOn: ["filter"], entityIds: analysis.matchedEntityIds }]
    : [];
  const aggregateDependency = entityNeeded ? "entity" : "filter";

  if (capabilities.directAggregation && ["COUNT", "EXISTS", "DISTINCT", "GROUP_BY", "FACET"].includes(analysis.intent)) {
    const aggregateOp = analysis.intent as "COUNT" | "EXISTS" | "DISTINCT" | "GROUP_BY" | "FACET";
    const aggregate: ExecutionNode = {
      id: "aggregate",
      op: aggregateOp,
      dependsOn: [aggregateDependency],
      fieldId: analysis.aggregationField?.fieldId,
      fieldKey: analysis.aggregationField?.fieldKey,
      limit: boundedLimit
    };
    return validateExecutionPlan({
      version: 2,
      intent: analysis.intent,
      strategy: "DETERMINISTIC",
      nodes: [filter, ...entity, aggregate, { id: "answer", op: "ANSWER", dependsOn: ["aggregate"], answerMode: "DIRECT" }],
      capabilities,
      estimates,
      requiresLlmAnswer: false,
      estimatedCost: estimates.filteredDocuments > 10_000 ? "MEDIUM" : "LOW"
    });
  }

  if (analysis.intent === "TIMELINE") {
    const sort: ExecutionNode = {
      id: "sort",
      op: "SORT",
      dependsOn: [aggregateDependency],
      fieldId: analysis.aggregationField?.fieldId,
      fieldKey: analysis.aggregationField?.fieldKey ?? "date",
      direction: /\b(en yeni|latest|newest)\b/u.test(analysis.originalQuery.toLocaleLowerCase("tr-TR")) ? "DESC" : "ASC",
      limit: boundedLimit
    };
    return validateExecutionPlan({
      version: 2,
      intent: analysis.intent,
      strategy: "DETERMINISTIC",
      nodes: [filter, ...entity, sort, { id: "limit", op: "LIMIT", dependsOn: ["sort"], limit: boundedLimit }, { id: "answer", op: "ANSWER", dependsOn: ["limit"], answerMode: "DIRECT" }],
      capabilities,
      estimates,
      requiresLlmAnswer: false,
      estimatedCost: "LOW"
    });
  }

  const retrieval: ExecutionNode[] = [];
  if (entityNeeded) retrieval.push({ ...entity[0], parallelGroup: "RETRIEVAL" });
  const exactEntitySufficient = analysis.intent === "FIND"
    && analysis.matchedEntityIds.length > 0
    && estimates.filteredDocuments > 0
    && estimates.filteredDocuments <= 3;
  if (capabilities.lexicalSearch && !exactEntitySufficient) retrieval.push({ id: "lexical", op: "LEXICAL_SEARCH", dependsOn: ["filter"], parallelGroup: "RETRIEVAL", query: analysis.semanticQuery, limit: boundedLimit });
  const semanticUseful = capabilities.semanticSearch
    && (analysis.queryType !== "ENTITY_SEARCH" || ["SUMMARIZE", "COMPARE"].includes(analysis.intent))
    && !(analysis.intent === "FIND" && estimates.filteredDocuments > 0 && estimates.filteredDocuments <= 3);
  if (semanticUseful) retrieval.push({ id: "semantic", op: "SEMANTIC_SEARCH", dependsOn: ["filter"], parallelGroup: "RETRIEVAL", query: analysis.semanticQuery, limit: boundedLimit });
  const terminalIds = retrieval.map((node) => node.id);
  const nodes: ExecutionNode[] = [filter, ...retrieval];
  let answerDependencies = terminalIds.length ? terminalIds : ["filter"];
  if (terminalIds.length > 1 && estimates.expectedRows > 3) {
    nodes.push({ id: "fusion", op: "RRF", dependsOn: terminalIds, limit: boundedLimit });
    answerDependencies = ["fusion"];
  }
  const hasLockedRuleAnchors = analysis.filters.some((filter) => filter.locked && filter.source === "RULE");
  if (answerDependencies[0] === "fusion" && estimates.expectedRows > 8 && !hasLockedRuleAnchors) {
    nodes.push({ id: "rerank", op: "RERANK", dependsOn: answerDependencies, limit: boundedLimit });
    answerDependencies = ["rerank"];
  }
  nodes.push({
    id: "answer",
    op: "ANSWER",
    dependsOn: answerDependencies,
    answerMode: analysis.intent === "SUMMARIZE" ? "SUMMARY" : analysis.intent === "COMPARE" ? "COMPARISON" : "GENERATIVE"
  });
  return validateExecutionPlan({
    version: 2,
    intent: analysis.intent,
    strategy: "GENERATIVE",
    nodes,
    capabilities,
    estimates,
    requiresLlmAnswer: true,
    estimatedCost: semanticUseful ? "HIGH" : "MEDIUM"
  });
}

export function validateExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  if (plan.version !== 2 || plan.nodes.length < 2 || plan.nodes.length > 16) throw new Error("Invalid execution plan.");
  const ids = new Set(plan.nodes.map((node) => node.id));
  if (ids.size !== plan.nodes.length || plan.nodes.at(-1)?.op !== "ANSWER") throw new Error("Execution plan boundaries are invalid.");
  for (const node of plan.nodes) {
    if (node.dependsOn.some((dependency) => !ids.has(dependency) || dependency === node.id)) throw new Error("Execution plan dependency is invalid.");
    if (node.limit !== undefined && (!Number.isInteger(node.limit) || node.limit < 1 || node.limit > 100)) throw new Error("Execution plan limit is invalid.");
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const visit = (id: string) => {
    if (active.has(id)) throw new Error("Execution plan contains a cycle.");
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    active.delete(id);
    visited.add(id);
  };
  for (const node of plan.nodes) visit(node.id);
  const direct = plan.nodes.some((node) => ["COUNT", "EXISTS", "DISTINCT", "GROUP_BY", "FACET", "SORT"].includes(node.op));
  if (direct && plan.requiresLlmAnswer) throw new Error("Execution plan strategy is inconsistent.");
  return plan;
}

export function executionPlanHas(plan: ExecutionPlan, op: ExecutionOperation) {
  return plan.nodes.some((node) => node.op === op);
}

function pickCapabilities(context: PlannerContext): Partial<PlannerCapabilities> {
  return Object.fromEntries(Object.entries(context).filter(([key]) => key in defaultCapabilities)) as Partial<PlannerCapabilities>;
}

function pickEstimates(context: PlannerContext): Partial<PlannerEstimates> {
  return Object.fromEntries(Object.entries(context).filter(([key]) => key in defaultEstimates)) as Partial<PlannerEstimates>;
}
