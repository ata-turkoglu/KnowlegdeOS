import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { getDashboardSummary } from "../services/dashboard.js";

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

export async function registerDashboardRoutes(
  app: FastifyInstance,
  config: ApiConfig
) {
  app.get<{ Querystring: { workspaceSlug?: string } }>(
    "/api/dashboard/summary",
    async (request, reply) => {
      try {
        return await getDashboardSummary(
          config,
          request.query.workspaceSlug || "merter-arsivi"
        );
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );
}
