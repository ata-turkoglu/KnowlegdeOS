import type { FastifyInstance, FastifyReply } from "fastify";
import type { MultipartValue, SavedMultipartFile } from "@fastify/multipart";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { convertWordDocument, deleteConvertedFile, getConvertedFile, listConvertedFiles, splitConvertedFile } from "../services/conversions.js";

function fail(reply: FastifyReply, error: unknown) {
  if (isHttpError(error)) return reply.code(error.statusCode).send({ error: error.message });
  return reply.code(500).send({ error: error instanceof Error ? error.message : "Conversion failed." });
}

export async function registerConversionRoutes(app: FastifyInstance, config: ApiConfig) {
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
}
