import type { FastifyInstance, FastifyReply } from "fastify";
import type { MultipartValue, SavedMultipartFile } from "@fastify/multipart";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import {
  getStoredDocumentDetail,
  checkUploadConflicts,
  listStoredDocuments,
  reindexStoredDocument,
  storeUploadedDocument
} from "../services/documents.js";

type ReindexOperation = {
  stage: string;
  status: "running" | "completed" | "cancelled" | "failed";
  updatedAt: string;
};

const reindexOperations = new Map<string, ReindexOperation>();

function updateReindexOperation(
  operationId: string | undefined,
  update: Pick<ReindexOperation, "stage" | "status">
) {
  if (!operationId) {
    return;
  }

  reindexOperations.set(operationId, { ...update, updatedAt: new Date().toISOString() });
}

function fieldValue(field: MultipartValue<unknown> | undefined) {
  return typeof field?.value === "string" ? field.value : undefined;
}

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

export async function registerDocumentRoutes(app: FastifyInstance, config: ApiConfig) {
  app.post<{ Body: { workspaceSlug?: string; files?: Array<{ filename?: string; hash?: string }> } }>("/api/documents/conflicts", async (request, reply) => {
    const files = request.body?.files;
    if (!files?.length || files.some((file) => !file.filename || !file.hash)) {
      return reply.code(400).send({ error: "File names and hashes are required." });
    }
    try {
      return await checkUploadConflicts(config, {
        workspaceSlug: request.body?.workspaceSlug,
        files: files.map((file) => ({ filename: file.filename!, hash: file.hash! }))
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get<{ Params: { operationId: string } }>(
    "/api/reindex-operations/:operationId",
    async (request, reply) => {
      const operation = reindexOperations.get(request.params.operationId);

      if (!operation) {
        return reply.code(404).send({ error: "Reindex operation was not found." });
      }

      return operation;
    }
  );

  app.get<{ Querystring: { workspaceSlug?: string } }>(
    "/api/documents",
    async (request, reply) => {
      try {
        return await listStoredDocuments(
          config,
          request.query.workspaceSlug || "merter-arsivi"
        );
      } catch (error) {
        return handleError(reply, error);
      }
    }
  );

  app.post("/api/documents/upload", async (request, reply) => {
    try {
      const files = await request.saveRequestFiles();
      const markdownFile = files.find((file) => file.fieldname === "markdown");
      const originalFile = files.find((file) => file.fieldname === "original");
      const fields = markdownFile?.fields ?? {};
      const title = Array.isArray(fields.title) ? fields.title[0] : fields.title;
      const workspaceSlug = Array.isArray(fields.workspaceSlug)
        ? fields.workspaceSlug[0]
        : fields.workspaceSlug;

      if (!markdownFile) {
        return reply.code(400).send({
          error: "Markdown file is required."
        });
      }

      const document = await storeUploadedDocument(config, {
        title: fieldValue(title as MultipartValue<unknown> | undefined),
        workspaceSlug: fieldValue(workspaceSlug as MultipartValue<unknown> | undefined),
        markdownFile: markdownFile as SavedMultipartFile,
        originalFile: originalFile as SavedMultipartFile | undefined
      });

      return reply.code(201).send(document);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post("/api/documents/upload-batch", async (request, reply) => {
    try {
      const files = await request.saveRequestFiles();
      const markdownFiles = files.filter((file) => file.fieldname === "markdown");
      const fields = markdownFiles[0]?.fields ?? {};
      const workspaceSlug = Array.isArray(fields.workspaceSlug)
        ? fields.workspaceSlug[0]
        : fields.workspaceSlug;

      if (markdownFiles.length === 0) {
        return reply.code(400).send({
          error: "At least one Markdown file is required."
        });
      }

      const documents = [];

      for (const markdownFile of markdownFiles) {
        documents.push(
          await storeUploadedDocument(config, {
            workspaceSlug: fieldValue(workspaceSlug as MultipartValue<unknown> | undefined),
            markdownFile: markdownFile as SavedMultipartFile
          })
        );
      }

      return reply.code(201).send({ documents });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get<{
    Params: {
      workspaceSlug: string;
      documentName: string;
    };
  }>("/api/documents/:workspaceSlug/:documentName", async (request, reply) => {
    try {
      return await getStoredDocumentDetail(config, {
        workspaceSlug: request.params.workspaceSlug,
        documentName: request.params.documentName
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post<{
    Params: {
      workspaceSlug: string;
      documentName: string;
    };
    Body: {
      useLlm?: boolean;
    };
  }>(
    "/api/documents/:workspaceSlug/:documentName/reindex",
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const operationId = request.headers["x-reindex-operation-id"];
      const resolvedOperationId =
        typeof operationId === "string" && operationId.length > 0 ? operationId : undefined;
      request.raw.once("aborted", abort);
      updateReindexOperation(resolvedOperationId, {
        stage: "Starting reindexing",
        status: "running"
      });

      try {
        const document = await reindexStoredDocument(config, {
          workspaceSlug: request.params.workspaceSlug,
          documentName: request.params.documentName,
          useLlm: request.body?.useLlm === true,
          signal: controller.signal,
          onProgress: (stage) =>
            updateReindexOperation(resolvedOperationId, { stage, status: "running" })
        });

        updateReindexOperation(resolvedOperationId, {
          stage: controller.signal.aborted ? "Cancelled" : "Completed",
          status: controller.signal.aborted ? "cancelled" : "completed"
        });

        return reply.send(document);
      } catch (error) {
        updateReindexOperation(resolvedOperationId, {
          stage: controller.signal.aborted ? "Cancelled" : "Reindexing failed",
          status: controller.signal.aborted ? "cancelled" : "failed"
        });
        return handleError(reply, error);
      } finally {
        request.raw.removeListener("aborted", abort);
      }
    }
  );
}
