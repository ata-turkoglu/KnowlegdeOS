import type { FastifyInstance, FastifyReply } from "fastify";
import type { MultipartValue, SavedMultipartFile } from "@fastify/multipart";
import { createHash, randomUUID } from "node:crypto";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import {
  getStoredDocumentDetail,
  getStoredDocumentStatuses,
  getStoredDocumentHash,
  checkUploadConflicts,
  discardUnindexedDocuments,
  listStoredDocuments,
  reindexStoredDocument,
  storeUploadedDocument
} from "../services/documents.js";
import { getConvertedFile } from "../services/conversions.js";
import { cancelTrackedOperation, clearOperationHistory, createOperation, findRunningOperation, interruptAllRunningOperations, listOperations, updateOperation, type DocumentIndexingRecord } from "../services/operations.js";
import type { IndexingRequestMode, IndexingStageName } from "../services/indexing-plan.js";
import { getGpuMetrics } from "../services/gpu.js";
import { embedSelectedDocuments, getEmbeddingCoverage, invalidateSemanticIndex } from "../services/semantic-search.js";

type ReindexOperation = {
  stage: string;
  status: "running" | "completed" | "cancelled" | "failed";
  updatedAt: string;
};

const reindexOperations = new Map<string, ReindexOperation>();

type BatchReindexOperation = {
  workspaceSlug: string;
  status: "running" | "completed" | "cancelled" | "failed";
  completed: number;
  total: number;
  documentName?: string;
  error?: string;
  controller: AbortController;
};

const batchReindexOperations = new Map<string, BatchReindexOperation>();
type IndexingRequestBody = {
  documentNames?: string[];
  mode?: IndexingRequestMode;
  requestedStages?: Partial<Record<IndexingStageName, boolean>>;
  /** Deprecated compatibility input. New clients select stages explicitly. */
  useLlm?: boolean;
};

function indexingIntent(body: IndexingRequestBody | undefined) {
  if (body?.requestedStages || body?.mode === 'user_configured') return { mode: 'user_configured' as const, requestedStages: body.requestedStages };
  if (body?.useLlm === undefined) return { mode: 'automatic' as const };
  return { mode: 'user_configured' as const, requestedStages: { aliases: body.useLlm, relationships: body.useLlm, claims: body.useLlm, summary: body.useLlm } };
}
const activeBatchReindexOperations = new Map<string, string>();
const embeddingOperations = new Map<string, AbortController>();

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

function uploadError(reply: FastifyReply, error: unknown, filename?: string) {
  const message = error instanceof Error ? error.message : "Unknown upload error.";
  const prefix = filename ? `Could not upload \"${filename}\": ` : "Could not upload file: ";
  return reply.code(isHttpError(error) ? error.statusCode : 500).send({ error: `${prefix}${message}` });
}

export async function registerDocumentRoutes(app: FastifyInstance, config: ApiConfig) {
  await interruptAllRunningOperations(config);
  async function rejectIfOperationRunning(workspaceSlug: string, reply: FastifyReply) {
    const active = await findRunningOperation(config, workspaceSlug);
    if (!active) return false;
    reply.code(409).send({ error: `An operation is already running: ${active.targetName}. Stop it before starting a new operation.` });
    return true;
  }
  app.get<{ Querystring: { workspaceSlug?: string } }>("/api/operations", async (request) =>
    listOperations(config, request.query.workspaceSlug || "merter-arsivi"));
  app.delete<{ Querystring: { workspaceSlug?: string } }>("/api/operations", async (request) =>
    clearOperationHistory(config, request.query.workspaceSlug || "merter-arsivi"));
  app.get("/api/gpu", async () => getGpuMetrics());

  app.get<{ Params: { workspaceSlug: string } }>("/api/documents/:workspaceSlug/embedding-coverage", async (request, reply) => {
    try { return await getEmbeddingCoverage(config, request.params.workspaceSlug); }
    catch (error) { return handleError(reply, error); }
  });
  app.post<{ Params: { workspaceSlug: string }; Body: { documentNames?: string[] } }>("/api/documents/:workspaceSlug/embeddings", async (request, reply) => {
    const requestedNames = request.body?.documentNames?.filter(Boolean) ?? [];
    if (requestedNames.length === 0) return reply.code(400).send({ error: "At least one indexed document is required." });
    if (await rejectIfOperationRunning(request.params.workspaceSlug, reply)) return;
    const missingNames = new Set((await getEmbeddingCoverage(config, request.params.workspaceSlug)).filter((item) => item.status === "MISSING").map((item) => item.documentName));
    const documentNames = [...new Set(requestedNames)].filter((name) => missingNames.has(name));
    if (documentNames.length === 0) return reply.code(400).send({ error: "Selected documents are already in the vector index or are not indexed." });
    const operation = await createOperation(config, { workspaceSlug: request.params.workspaceSlug, kind: "embedding", targetName: `${documentNames.length} document${documentNames.length === 1 ? "" : "s"}`, documentNames, status: "running", stage: "Creating embeddings", progress: 0 });
    const controller = new AbortController();
    embeddingOperations.set(operation.id, controller);
    void (async () => {
      try {
        await embedSelectedDocuments(config, request.params.workspaceSlug, documentNames, ({ completed, total, documentName }) => void updateOperation(config, request.params.workspaceSlug, operation.id, { stage: `Embedding ${documentName}`, progress: Math.round((completed / total) * 100) }), controller.signal);
        await updateOperation(config, request.params.workspaceSlug, operation.id, { status: controller.signal.aborted ? "cancelled" : "completed", stage: controller.signal.aborted ? "Cancelled" : "Completed", progress: controller.signal.aborted ? 0 : 100 });
      } catch (error) {
        await updateOperation(config, request.params.workspaceSlug, operation.id, controller.signal.aborted
          ? { status: "cancelled", stage: "Cancelled" }
          : { status: "failed", stage: "Embedding failed", error: error instanceof Error ? error.message : "Embedding failed." });
      } finally {
        embeddingOperations.delete(operation.id);
      }
    })();
    return reply.code(202).send({ operationId: operation.id });
  });
  app.delete<{ Params: { operationId: string } }>("/api/operations/:operationId", async (request, reply) => {
    const controller = embeddingOperations.get(request.params.operationId);
    if (cancelTrackedOperation(request.params.operationId)) return reply.code(202).send({ status: "cancelling" });
    if (!controller) return reply.code(404).send({ error: "This operation cannot be cancelled or is no longer running." });
    controller.abort();
    return reply.code(202).send({ status: "cancelling" });
  });
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

  app.post<{ Body: { workspaceSlug?: string; filenames?: string[] } }>("/api/documents/conversion-conflicts", async (request, reply) => {
    const filenames = request.body?.filenames;
    if (!filenames?.length || filenames.some((filename) => !filename)) {
      return reply.code(400).send({ error: "Converted file names are required." });
    }
    try {
      const workspaceSlug = request.body?.workspaceSlug || "inbox";
      // A conversion workspace can contain hundreds of files.  Running every
      // database lookup at once exhausts SQLite's connection pool and turns
      // the entire status request into a 500 response.
      const statuses = [];
      for (const filename of filenames) {
        const existing = await getStoredDocumentHash(config, { workspaceSlug, filename });
        if (!existing.hash) {
          statuses.push({ filename, documentName: existing.documentName, status: "NEW" as const, indexed: false });
          continue;
        }
        const hash = createHash("sha256").update(await getConvertedFile(config, workspaceSlug, filename)).digest("hex");
        statuses.push({ filename, documentName: existing.documentName, status: existing.hash === hash ? "DUPLICATE" as const : "CONFLICT" as const, indexed: existing.status === "INDEXED" });
      }
      return statuses;
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

  app.post<{ Body: { workspaceSlug?: string; documentNames?: string[] } }>("/api/documents/statuses", async (request, reply) => {
    const documentNames = request.body?.documentNames?.filter(Boolean) ?? [];
    if (documentNames.length === 0) return reply.code(400).send({ error: "At least one document is required." });
    try { return await getStoredDocumentStatuses(config, { workspaceSlug: request.body?.workspaceSlug || "merter-arsivi", documentNames }); }
    catch (error) { return handleError(reply, error); }
  });

  app.get<{ Querystring: { workspaceSlug?: string } }>("/api/documents/reindex-batches/active", async (request) => {
    const operationId = activeBatchReindexOperations.get(request.query.workspaceSlug || "merter-arsivi");
    if (!operationId) return null;
    const operation = batchReindexOperations.get(operationId);
    if (!operation) return null;
    return { operationId, ...operation, controller: undefined };
  });

  app.get<{ Params: { operationId: string } }>("/api/documents/reindex-batches/:operationId", async (request, reply) => {
    const operation = batchReindexOperations.get(request.params.operationId);
    if (!operation) return reply.code(404).send({ error: "Reindex operation was not found." });
    return { ...operation, controller: undefined };
  });

  app.delete<{ Params: { operationId: string } }>("/api/documents/reindex-batches/:operationId", async (request, reply) => {
    const operation = batchReindexOperations.get(request.params.operationId);
    if (!operation) return reply.code(404).send({ error: "Reindex operation was not found." });
    operation.controller.abort();
    return reply.code(202).send({ status: "cancelling" });
  });

  app.post<{
    Params: { workspaceSlug: string };
    Body: IndexingRequestBody;
  }>("/api/documents/:workspaceSlug/reindex-batch", async (request, reply) => {
    const documentNames = request.body?.documentNames?.filter(Boolean) ?? [];
    if (documentNames.length === 0) {
      return reply.code(400).send({ error: "At least one document is required." });
    }
    if (await rejectIfOperationRunning(request.params.workspaceSlug, reply)) return;

    if (activeBatchReindexOperations.has(request.params.workspaceSlug)) {
      return reply.code(409).send({ error: "A batch reindex operation is already running." });
    }

    const operationId = randomUUID();
    const operation: BatchReindexOperation = {
      workspaceSlug: request.params.workspaceSlug,
      status: "running",
      completed: 0,
      total: documentNames.length,
      controller: new AbortController()
    };
    batchReindexOperations.set(operationId, operation);
    activeBatchReindexOperations.set(request.params.workspaceSlug, operationId);
    const intent = indexingIntent(request.body);
    const persisted = await createOperation(config, { workspaceSlug: request.params.workspaceSlug, kind: "index", targetName: documentNames.join(", "), documentNames, status: "running", stage: "Preparing document", progress: 0, retry: { mode: intent.mode } });

    void (async () => {
      try {
        const indexedDocumentNames: string[] = [];
        const documentIndexing: Record<string, DocumentIndexingRecord> = {};
        let partial = false;
        for (const documentName of documentNames) {
          if (operation.controller.signal.aborted) break;
          operation.documentName = documentName;
          await updateOperation(config, request.params.workspaceSlug, persisted.id, { stage: "Preparing document", progress: Math.round((operation.completed / operation.total) * 100) });
          const indexed = await reindexStoredDocument(config, {
            workspaceSlug: request.params.workspaceSlug,
            documentName,
            ...intent,
            signal: operation.controller.signal,
            invalidateSemanticIndex: false,
            onProgress: (stage) => void updateOperation(config, request.params.workspaceSlug, persisted.id, { stage })
          });
          documentIndexing[documentName] = { indexingPlan: indexed.indexingPlan, stageResults: indexed.stageResults, traceId: indexed.traceId };
          await updateOperation(config, request.params.workspaceSlug, persisted.id, { indexingPlan: indexed.indexingPlan, stageResults: indexed.stageResults, traceId: indexed.traceId, documentIndexing });
          partial ||= Boolean(indexed.llmExtractionError) || Object.values(indexed.stageResults ?? {}).some((stage) => stage.status === 'succeeded_with_warnings');
          operation.completed += 1;
          indexedDocumentNames.push(documentName);
        }
        operation.status = operation.controller.signal.aborted ? "cancelled" : "completed";
        await updateOperation(config, request.params.workspaceSlug, persisted.id, { status: operation.status === "completed" ? (partial ? 'partial' : 'completed') : "cancelled", stage: operation.status === "completed" ? (partial ? 'Completed with graph-stage failures' : "Completed") : "Cancelled", progress: operation.status === "completed" ? 100 : Math.round((operation.completed / operation.total) * 100) });
        if (operation.status === "completed" && indexedDocumentNames.length > 0) {
          const embeddingOperation = await createOperation(config, { workspaceSlug: request.params.workspaceSlug, kind: "embedding", targetName: `${indexedDocumentNames.length} document${indexedDocumentNames.length === 1 ? "" : "s"}`, documentNames: indexedDocumentNames, status: "running", stage: "Creating embeddings", progress: 0 });
          const embeddingController = new AbortController();
          embeddingOperations.set(embeddingOperation.id, embeddingController);
          try {
            await embedSelectedDocuments(config, request.params.workspaceSlug, indexedDocumentNames, ({ completed, total, documentName }) => void updateOperation(config, request.params.workspaceSlug, embeddingOperation.id, { stage: `Embedding ${documentName}`, progress: Math.round((completed / total) * 100) }), embeddingController.signal);
            await updateOperation(config, request.params.workspaceSlug, embeddingOperation.id, { status: embeddingController.signal.aborted ? "cancelled" : "completed", stage: embeddingController.signal.aborted ? "Cancelled" : "Completed", progress: embeddingController.signal.aborted ? 0 : 100 });
          } catch (error) {
            await invalidateSemanticIndex(config, request.params.workspaceSlug);
            await updateOperation(config, request.params.workspaceSlug, embeddingOperation.id, embeddingController.signal.aborted
              ? { status: "cancelled", stage: "Cancelled" }
              : { status: "failed", stage: "Embedding failed", error: error instanceof Error ? error.message : "Embedding failed." });
          } finally {
            embeddingOperations.delete(embeddingOperation.id);
          }
        }
      } catch (error) {
        operation.status = operation.controller.signal.aborted ? "cancelled" : "failed";
        operation.error = error instanceof Error ? error.message : "Reindexing failed.";
        await updateOperation(config, request.params.workspaceSlug, persisted.id, { status: operation.status === "cancelled" ? "cancelled" : "failed", stage: operation.status === "cancelled" ? "Cancelled" : "Reindexing failed", error: operation.error });
      } finally {
        if (operation.status !== "completed") {
          // A partially reindexed batch may have changed metadata while the
          // previous vectors remain on disk. Drop that stale index so the next
          // semantic read rebuilds it from the current document metadata.
          await invalidateSemanticIndex(config, request.params.workspaceSlug);
          await discardUnindexedDocuments(config, {
            workspaceSlug: request.params.workspaceSlug,
            documentNames
          });
        }
        activeBatchReindexOperations.delete(request.params.workspaceSlug);
        setTimeout(() => batchReindexOperations.delete(operationId), 15 * 60 * 1_000);
      }
    })();

    return reply.code(202).send({ operationId });
  });

  app.post("/api/documents/upload", async (request, reply) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortIfConnectionCloses = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    request.raw.once("aborted", abort);
    reply.raw.once("close", abortIfConnectionCloses);
    let operation: Awaited<ReturnType<typeof createOperation>> | undefined;
    let uploadedFilename: string | undefined;
    try {
      const files = await request.saveRequestFiles();
      const markdownFile = files.find((file) => file.fieldname === "markdown");
      uploadedFilename = markdownFile?.filename;
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
      if (await rejectIfOperationRunning(fieldValue(workspaceSlug as MultipartValue<unknown> | undefined) || "merter-arsivi", reply)) return;

      operation = await createOperation(config, { workspaceSlug: fieldValue(workspaceSlug as MultipartValue<unknown> | undefined) || "merter-arsivi", kind: "upload", targetName: markdownFile.filename, status: "running", stage: "Saving file", progress: 75 });
      const document = await storeUploadedDocument(config, {
        title: fieldValue(title as MultipartValue<unknown> | undefined),
        workspaceSlug: fieldValue(workspaceSlug as MultipartValue<unknown> | undefined),
        markdownFile: markdownFile as SavedMultipartFile,
        originalFile: originalFile as SavedMultipartFile | undefined,
        signal: controller.signal
      });
      await updateOperation(config, operation.workspaceSlug, operation.id, { status: "completed", stage: "Completed", progress: 100 });

      return reply.code(201).send(document);
    } catch (error) {
      if (operation) {
        await updateOperation(config, operation.workspaceSlug, operation.id, controller.signal.aborted
          ? { status: "cancelled", stage: "Cancelled" }
          : { status: "failed", stage: "Upload failed", error: error instanceof Error ? error.message : "Upload failed." });
      }
      return uploadError(reply, error, uploadedFilename);
    } finally {
      request.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", abortIfConnectionCloses);
    }
  });

  app.post("/api/documents/upload-batch", async (request, reply) => {
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort());

    let currentFilename: string | undefined;
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

      if (await rejectIfOperationRunning(fieldValue(workspaceSlug as MultipartValue<unknown> | undefined) || "merter-arsivi", reply)) return;

      const documents = [];
      const resolvedWorkspaceSlug = fieldValue(workspaceSlug as MultipartValue<unknown> | undefined) || "merter-arsivi";
      const operation = await createOperation(config, {
        workspaceSlug: resolvedWorkspaceSlug,
        kind: "upload",
        targetName: `${markdownFiles.length} Markdown file${markdownFiles.length === 1 ? "" : "s"}`,
        status: "running",
        stage: "Saving files",
        progress: 0
      });

      for (const [index, markdownFile] of markdownFiles.entries()) {
        currentFilename = markdownFile.filename;
        if (controller.signal.aborted) {
          await updateOperation(config, resolvedWorkspaceSlug, operation.id, { status: "cancelled", stage: "Cancelled", progress: Math.round((index / markdownFiles.length) * 100) });
          return reply.code(499).send({ error: "Upload cancelled." });
        }

        try { documents.push(
          await storeUploadedDocument(config, {
            workspaceSlug: fieldValue(workspaceSlug as MultipartValue<unknown> | undefined),
            markdownFile: markdownFile as SavedMultipartFile,
            signal: controller.signal
          })); await updateOperation(config, resolvedWorkspaceSlug, operation.id, { stage: "Saving files", progress: Math.round(((index + 1) / markdownFiles.length) * 100) });
        } catch (error) { await updateOperation(config, resolvedWorkspaceSlug, operation.id, controller.signal.aborted ? { status: "cancelled", stage: "Cancelled" } : { status: "failed", stage: "Upload failed", error: error instanceof Error ? error.message : "Upload failed." }); throw error; }
      }
      await updateOperation(config, resolvedWorkspaceSlug, operation.id, { status: "completed", stage: "Completed", progress: 100 });

      return reply.code(201).send({ documents });
    } catch (error) {
      return uploadError(reply, error, currentFilename);
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
    Body: IndexingRequestBody;
  }>(
    "/api/documents/:workspaceSlug/:documentName/reindex",
    async (request, reply) => {
      if (await rejectIfOperationRunning(request.params.workspaceSlug, reply)) return;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const operationId = request.headers["x-reindex-operation-id"];
      const resolvedOperationId =
        typeof operationId === "string" && operationId.length > 0 ? operationId : undefined;
      const persisted = await createOperation(config, {
        workspaceSlug: request.params.workspaceSlug,
        kind: "reindex",
        targetName: request.params.documentName,
        status: "running",
        stage: "Starting reindexing",
        progress: 0,
        retry: { documentName: request.params.documentName, mode: indexingIntent(request.body).mode }
      });
      request.raw.once("aborted", abort);
      updateReindexOperation(resolvedOperationId, {
        stage: "Starting reindexing",
        status: "running"
      });

      try {
        const document = await reindexStoredDocument(config, {
          workspaceSlug: request.params.workspaceSlug,
          documentName: request.params.documentName,
          ...indexingIntent(request.body),
          signal: controller.signal,
          onProgress: (stage) => {
            updateReindexOperation(resolvedOperationId, { stage, status: "running" });
            void updateOperation(config, request.params.workspaceSlug, persisted.id, { stage, progress: stage === "Completed" ? 100 : 50 });
          }
        });
        await updateOperation(config, request.params.workspaceSlug, persisted.id, { indexingPlan: document.indexingPlan, stageResults: document.stageResults, traceId: document.traceId, documentIndexing: { [request.params.documentName]: { indexingPlan: document.indexingPlan, stageResults: document.stageResults, traceId: document.traceId } } });

        updateReindexOperation(resolvedOperationId, {
          stage: controller.signal.aborted ? "Cancelled" : "Completed",
          status: controller.signal.aborted ? "cancelled" : "completed"
        });
        const partial = Boolean(document.llmExtractionError) || Object.values(document.stageResults ?? {}).some((stage) => stage.status === 'succeeded_with_warnings');
        await updateOperation(config, request.params.workspaceSlug, persisted.id, { status: controller.signal.aborted ? "cancelled" : partial ? 'partial' : "completed", stage: controller.signal.aborted ? "Cancelled" : partial ? 'Completed with graph-stage warnings' : "Completed", progress: controller.signal.aborted ? 50 : 100 });

        return reply.send(document);
      } catch (error) {
        updateReindexOperation(resolvedOperationId, {
          stage: controller.signal.aborted ? "Cancelled" : "Reindexing failed",
          status: controller.signal.aborted ? "cancelled" : "failed"
        });
        await updateOperation(config, request.params.workspaceSlug, persisted.id, { status: controller.signal.aborted ? "cancelled" : "failed", stage: controller.signal.aborted ? "Cancelled" : "Reindexing failed", error: error instanceof Error ? error.message : "Reindexing failed." });
        return handleError(reply, error);
      } finally {
        request.raw.removeListener("aborted", abort);
      }
    }
  );
}
