import type { FastifyInstance, FastifyReply } from "fastify";
import type { MultipartValue, SavedMultipartFile } from "@fastify/multipart";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { addGeneratedYamlMetadata, convertWordDocument, deleteConvertedFile, getConvertedFile, listConvertedFiles, metadataBatchConcurrency, splitConvertedFile } from "../services/conversions.js";
import { createOperation, findRunningOperation, releaseOperationController, trackOperationController, updateOperation } from "../services/operations.js";

function fail(reply: FastifyReply, error: unknown) {
  if (isHttpError(error)) return reply.code(error.statusCode).send({ error: error.message });
  return reply.code(500).send({ error: error instanceof Error ? error.message : "Conversion failed." });
}

export async function registerConversionRoutes(app: FastifyInstance, config: ApiConfig) {
  async function startYamlGeneration(workspaceSlug: string, filenames: string[], reply: FastifyReply) {
    const uniqueFilenames = [...new Set(filenames.filter(Boolean))];
    if (uniqueFilenames.length === 0) return reply.code(400).send({ error: "At least one Markdown file is required." });
    const active = await findRunningOperation(config, workspaceSlug);
    if (active) return reply.code(409).send({ error: `An operation is already running: ${active.targetName}. Stop it before starting a new operation.` });

    const operation = await createOperation(config, {
      workspaceSlug,
      kind: "yaml",
      targetName: uniqueFilenames.length === 1 ? uniqueFilenames[0]! : `${uniqueFilenames.length} Markdown files`,
      documentNames: uniqueFilenames,
      status: "running",
      stage: "Queued for YAML metadata generation",
      progress: 0
    });
    const controller = new AbortController();
    let generationError: unknown;
    trackOperationController(operation.id, controller);
    void (async () => {
      try {
        const fileProgress = uniqueFilenames.map(() => 0);
        let nextIndex = 0;
        const worker = async () => {
          while (true) {
            const index = nextIndex++;
            const filename = uniqueFilenames[index];
            if (!filename) return;
            if (controller.signal.aborted) throw new Error("YAML metadata generation cancelled.");
            await updateOperation(config, workspaceSlug, operation.id, {
              stage: `Preparing ${filename} (${index + 1}/${uniqueFilenames.length})`,
              progress: Math.min(99, Math.round(fileProgress.reduce((sum, value) => sum + value, 0) / uniqueFilenames.length))
            });
            try {
              await addGeneratedYamlMetadata(config, workspaceSlug, filename, {
                signal: controller.signal,
                onProgress: async ({ stage, progress }) => {
                  fileProgress[index] = progress;
                  await updateOperation(config, workspaceSlug, operation.id, {
                    stage: `${filename}: ${stage}`,
                    progress: Math.min(99, Math.round(fileProgress.reduce((sum, value) => sum + value, 0) / uniqueFilenames.length))
                  });
                }
              });
              fileProgress[index] = 100;
            } catch (error) {
              if (!controller.signal.aborted) {
                generationError = error;
                controller.abort();
              }
              throw error;
            }
          }
        };
        const concurrency = Math.min(uniqueFilenames.length, metadataBatchConcurrency(config.metadataLlmModel));
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        await updateOperation(config, workspaceSlug, operation.id, { status: "completed", stage: "Completed", progress: 100 });
      } catch (error) {
        const cancelled = controller.signal.aborted && !generationError;
        const reportedError = generationError ?? error;
        await updateOperation(config, workspaceSlug, operation.id, {
          status: cancelled ? "cancelled" : "failed",
          stage: cancelled ? "Cancelled" : "YAML metadata generation failed",
          error: reportedError instanceof Error ? reportedError.message : "YAML metadata generation failed."
        });
      } finally {
        releaseOperationController(operation.id);
      }
    })();
    return reply.code(202).send({ operationId: operation.id });
  }

  app.get<{ Querystring: { workspaceSlug?: string } }>("/api/conversions", async (request, reply) => {
    try { return await listConvertedFiles(config, request.query.workspaceSlug || "inbox"); }
    catch (error) { return fail(reply, error); }
  });

  app.post("/api/conversions", async (request, reply) => {
    try {
      const files = await request.saveRequestFiles();
      const wordFile = files.find((file) => file.fieldname === "word");
      const workspaceField = wordFile?.fields.workspaceSlug as MultipartValue<unknown> | undefined;
      const workspaceSlug = typeof workspaceField?.value === "string" ? workspaceField.value : undefined;
      if (!wordFile) return reply.code(400).send({ error: "A Word .docx file is required." });
      const conversion = await convertWordDocument(config, {
        workspaceSlug,
        wordFile: wordFile as SavedMultipartFile
      });
      return reply.code(201).send(conversion);
    } catch (error) { return fail(reply, error); }
  });

  app.get<{ Params: { workspaceSlug: string; filename: string } }>("/api/conversions/:workspaceSlug/:filename", async (request, reply) => {
    try { return { markdown: await getConvertedFile(config, request.params.workspaceSlug, request.params.filename) }; }
    catch (error) { return fail(reply, error); }
  });

  app.delete<{ Params: { workspaceSlug: string; filename: string } }>("/api/conversions/:workspaceSlug/:filename", async (request, reply) => {
    try {
      await deleteConvertedFile(config, request.params.workspaceSlug, request.params.filename);
      return reply.code(204).send();
    } catch (error) { return fail(reply, error); }
  });

  app.post<{ Params: { workspaceSlug: string; filename: string } }>("/api/conversions/:workspaceSlug/:filename/split", async (request, reply) => {
    try { return await splitConvertedFile(config, request.params.workspaceSlug, request.params.filename); }
    catch (error) { return fail(reply, error); }
  });

  app.post<{ Params: { workspaceSlug: string; filename: string } }>("/api/conversions/:workspaceSlug/:filename/generate-yaml", async (request, reply) => {
    try { return await startYamlGeneration(request.params.workspaceSlug, [request.params.filename], reply); }
    catch (error) { return fail(reply, error); }
  });

  app.post<{ Params: { workspaceSlug: string }; Body: { filenames?: string[] } }>("/api/conversions/:workspaceSlug/generate-yaml-batch", async (request, reply) => {
    try { return await startYamlGeneration(request.params.workspaceSlug, request.body?.filenames ?? [], reply); }
    catch (error) { return fail(reply, error); }
  });
}
