import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import {
  addEntityAlias,
  getEntity,
  listEntities,
  mergeEntities,
  removeEntityAlias,
  rebuildEntityIndex
} from "../services/entities.js";

function handleError(reply: FastifyReply, error: unknown) {
  if (isHttpError(error)) {
    return reply.code(error.statusCode).send({
      error: error.message
    });
  }

  return reply.code(500).send({
    error: "Unexpected API error."
  });
}

function workspaceSlugFromQuery(query: { workspaceSlug?: string }) {
  return query.workspaceSlug || "merter-arsivi";
}

export async function registerEntityRoutes(app: FastifyInstance, config: ApiConfig) {
  app.get<{ Querystring: { workspaceSlug?: string } }>(
    "/api/entities",
    async (request, reply) => {
      try {
        return await listEntities(config, workspaceSlugFromQuery(request.query));
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.post<{ Querystring: { workspaceSlug?: string } }>(
    "/api/entities/rebuild",
    async (request, reply) => {
      try {
        return await rebuildEntityIndex(config, workspaceSlugFromQuery(request.query));
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { workspaceSlug?: string } }>(
    "/api/entities/:id",
    async (request, reply) => {
      try {
        return await getEntity(
          config,
          workspaceSlugFromQuery(request.query),
          request.params.id
        );
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { workspaceSlug?: string } }>(
    "/api/entities/:id/documents",
    async (request, reply) => {
      try {
        const entity = await getEntity(
          config,
          workspaceSlugFromQuery(request.query),
          request.params.id
        );

        return entity.documents;
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.post<{
    Params: { id: string };
    Querystring: { workspaceSlug?: string };
    Body: { alias?: string };
  }>("/api/entities/:id/aliases", async (request, reply) => {
    try {
      return await addEntityAlias(
        config,
        workspaceSlugFromQuery(request.query),
        request.params.id,
        request.body?.alias ?? ""
      );
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.delete<{
    Params: { id: string; normalizedAlias: string };
    Querystring: { workspaceSlug?: string };
  }>("/api/entities/:id/aliases/:normalizedAlias", async (request, reply) => {
    try {
      return await removeEntityAlias(
        config,
        workspaceSlugFromQuery(request.query),
        request.params.id,
        request.params.normalizedAlias
      );
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{
    Querystring: { workspaceSlug?: string };
    Body: { sourceEntityId?: string; targetEntityId?: string };
  }>("/api/entities/merge", async (request, reply) => {
    try {
      return await mergeEntities(
        config,
        workspaceSlugFromQuery(request.query),
        request.body?.sourceEntityId ?? "",
        request.body?.targetEntityId ?? ""
      );
    } catch (error) {
      return handleError(reply, error);
    }
  });
}
