import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import {
  createWorkspace,
  createWorkspaceExportManifest,
  getWorkspaceById,
  importWorkspaceSkeleton,
  listWorkspaces
} from "../services/workspaces.js";
import {
  createWorkspaceBackup,
  createWorkspaceExportBundle,
  importWorkspaceBundle,
  type WorkspaceTransferBundle
} from "../services/workspace-transfer.js";

type WorkspaceBody = {
  name?: unknown;
  description?: unknown;
};

type ImportBundleBody = {
  targetSlug?: unknown;
  bundle?: unknown;
};

function parseWorkspaceBody(body: unknown) {
  const value = (body ?? {}) as WorkspaceBody;

  return {
    name: typeof value.name === "string" ? value.name : "",
    description:
      typeof value.description === "string" ? value.description : undefined
  };
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  config: ApiConfig
) {
  app.get("/api/workspaces", async (_request, reply) => {
    try {
      return await listWorkspaces(config);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post("/api/workspaces", async (request, reply) => {
    try {
      const workspace = await createWorkspace(config, parseWorkspaceBody(request.body));
      return reply.code(201).send(workspace);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    try {
      return await getWorkspaceById(config, request.params.id);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/export",
    async (request, reply) => {
      try {
        return await createWorkspaceExportManifest(config, request.params.id);
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.post<{ Params: { workspaceSlug: string } }>(
    "/api/workspaces/:workspaceSlug/export-bundle",
    async (request, reply) => {
      try {
        return await createWorkspaceExportBundle(config, request.params.workspaceSlug);
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.post<{ Params: { workspaceSlug: string } }>(
    "/api/workspaces/:workspaceSlug/backups",
    async (request, reply) => {
      try {
        return await createWorkspaceBackup(config, request.params.workspaceSlug);
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.post("/api/workspaces/import", async (request, reply) => {
    try {
      const result = await importWorkspaceSkeleton(
        config,
        parseWorkspaceBody(request.body)
      );
      return reply.code(201).send(result);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post("/api/workspaces/import-bundle", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as ImportBundleBody;

      if (!body.bundle || typeof body.bundle !== "object") {
        return reply.code(400).send({
          error: "Workspace export bundle is required."
        });
      }

      const result = await importWorkspaceBundle(config, {
        targetSlug: typeof body.targetSlug === "string" ? body.targetSlug : undefined,
        bundle: body.bundle as WorkspaceTransferBundle
      });

      return reply.code(201).send(result);
    } catch (error) {
      return handleError(reply, error);
    }
  });
}

function handleError(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (isHttpError(error)) {
    return reply.code(error.statusCode).send({
      error: error.message
    });
  }

  return reply.code(500).send({
    error: "Unexpected API error."
  });
}
