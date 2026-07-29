import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { searchHybridDocuments } from "../services/hybrid-search.js";
import {
  rebuildSemanticIndex,
  searchSemanticDocuments
} from "../services/semantic-search.js";
import { searchEntityDocuments } from "../services/search.js";
import { analyzeQuery } from "../services/query-analyzer.js";
import { prepareQueryExecution } from "../services/execution-planner.js";
import { listExecutionTelemetry } from "../services/execution-telemetry.js";

function handleError(reply: FastifyReply, error: unknown) {
  if (isHttpError(error)) {
    return reply.code(error.statusCode).send({
      error: error.message
    });
  }

  return reply.code(500).send({
    error: error instanceof Error ? error.message : "Unexpected API error."
  });
}

export async function registerSearchRoutes(app: FastifyInstance, config: ApiConfig) {
  app.get<{
    Params: { workspaceSlug: string };
    Querystring: { limit?: number };
  }>("/api/workspaces/:workspaceSlug/query-executions", async (request, reply) => {
    try {
      return await listExecutionTelemetry(config, request.params.workspaceSlug, request.query.limit);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
      query?: string;
    };
  }>("/api/search/entity", async (request, reply) => {
    try {
      const query = request.body?.query?.trim();

      if (!query) {
        return reply.code(400).send({
          error: "Query is required."
        });
      }

      const workspaceSlug = request.body?.workspaceSlug || "merter-arsivi";
      const analysis = await analyzeQuery(config, { workspaceSlug, query });
      const planning = await prepareQueryExecution(config, workspaceSlug, { ...analysis, queryType: "ENTITY_SEARCH", intent: "FIND" });
      const allowedDocumentIds = planning.documentIds;
      const result = await searchEntityDocuments(config, {
        workspaceSlug,
        query,
        entityIds: analysis.matchedEntityIds,
        filters: { allowedDocumentIds }
      });
      return { ...result, analysis, executionPlan: planning.plan };
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
      query?: string;
      limit?: number;
    };
  }>("/api/search/semantic", async (request, reply) => {
    try {
      const query = request.body?.query?.trim();

      if (!query) {
        return reply.code(400).send({
          error: "Query is required."
        });
      }

      const workspaceSlug = request.body?.workspaceSlug || "merter-arsivi";
      const analysis = await analyzeQuery(config, { workspaceSlug, query });
      const planning = await prepareQueryExecution(config, workspaceSlug, { ...analysis, queryType: "SEMANTIC_SEARCH", intent: "FIND" }, request.body?.limit);
      const allowedDocumentIds = planning.documentIds;
      const result = await searchSemanticDocuments(config, {
        workspaceSlug,
        query,
        limit: request.body?.limit,
        filters: { allowedDocumentIds }
      });
      return { ...result, analysis, executionPlan: planning.plan };
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
    };
  }>("/api/search/semantic/rebuild", async (request, reply) => {
    try {
      return await rebuildSemanticIndex(
        config,
        request.body?.workspaceSlug || "merter-arsivi"
      );
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
      query?: string;
      limit?: number;
    };
  }>("/api/search/hybrid", async (request, reply) => {
    try {
      const query = request.body?.query?.trim();

      if (!query) {
        return reply.code(400).send({
          error: "Query is required."
        });
      }

      return await searchHybridDocuments(config, {
        workspaceSlug: request.body?.workspaceSlug || "merter-arsivi",
        query,
        limit: request.body?.limit
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });
}
