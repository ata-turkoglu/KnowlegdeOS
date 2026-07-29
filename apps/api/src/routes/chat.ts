import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { answerChat, type ChatAnswerLength } from "../services/chat.js";
import { deleteChatSession, listChatSessions, saveChatExchange } from "../services/chat-history.js";

const defaultWorkspaceSlug = "merter-arsivi";
const workspaceSlugSchema = {
  type: "string",
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
} as const;
const sessionIdSchema = { type: "string", format: "uuid" } as const;

const sessionQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    workspaceSlug: workspaceSlugSchema,
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    offset: { type: "integer", minimum: 0, maximum: 1_000_000, default: 0 }
  }
} as const;

const chatBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    workspaceSlug: workspaceSlugSchema,
    message: { type: "string", minLength: 1, maxLength: 20_000 },
    sessionId: sessionIdSchema,
    answerLength: { type: "string", enum: ["normal", "detailed"] },
    stream: { type: "boolean" }
  }
} as const;

const chatBodyKeys = new Set(["workspaceSlug", "message", "sessionId", "answerLength", "stream"]);
const workspaceSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatRouteDependencies = {
  answerChat: typeof answerChat;
  deleteChatSession: typeof deleteChatSession;
  listChatSessions: typeof listChatSessions;
  saveChatExchange: typeof saveChatExchange;
};

type ErrorWithCode = Error & { code?: string };

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function validateChatBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Request body must be an object.";
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !chatBodyKeys.has(key))) return "Request body contains an unsupported field.";
  if (typeof input.message !== "string" || input.message.length === 0 || input.message.length > 20_000) return "Message must be a string between 1 and 20000 characters.";
  if (input.workspaceSlug !== undefined && (
    typeof input.workspaceSlug !== "string"
    || input.workspaceSlug.length > 100
    || !workspaceSlugPattern.test(input.workspaceSlug)
  )) return "Workspace slug is invalid.";
  if (input.sessionId !== undefined && (typeof input.sessionId !== "string" || !uuidPattern.test(input.sessionId))) return "Session id is invalid.";
  if (input.answerLength !== undefined && input.answerLength !== "normal" && input.answerLength !== "detailed") return "Answer length is invalid.";
  if (input.stream !== undefined && typeof input.stream !== "boolean") return "Stream must be a boolean.";
  return null;
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as ErrorWithCode).code;
  return error.name === "TimeoutError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
}

function isUpstreamError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as ErrorWithCode).code;
  return ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code ?? "")
    || error.message === "fetch failed";
}

function publicError(error: unknown) {
  if (isHttpError(error)) return { statusCode: error.statusCode, message: error.message };
  if (isAbortError(error) || isTimeoutError(error)) {
    return { statusCode: 504, message: "Model yanıtı zaman aşımına uğradı." };
  }
  if (isUpstreamError(error)) {
    return { statusCode: 503, message: "Model servisine şu anda ulaşılamıyor." };
  }
  return { statusCode: 500, message: "Sohbet isteği işlenemedi." };
}

function handleError(app: FastifyInstance, reply: FastifyReply, error: unknown) {
  const response = publicError(error);
  if (!isHttpError(error)) app.log.error(error, "Chat request failed");
  if (reply.raw.destroyed || reply.raw.writableEnded) return reply;
  return reply.code(response.statusCode).send({ error: response.message });
}

function canWrite(reply: FastifyReply) {
  return !reply.raw.destroyed && !reply.raw.writableEnded;
}

async function writeRaw(reply: FastifyReply, payload: string) {
  if (!canWrite(reply)) return false;
  try {
    if (reply.raw.write(payload)) return true;
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      reply.raw.removeListener("drain", onDrain);
      reply.raw.removeListener("close", onClose);
      reply.raw.removeListener("error", onClose);
    };
    const onDrain = () => { cleanup(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    reply.raw.once("drain", onDrain);
    reply.raw.once("close", onClose);
    reply.raw.once("error", onClose);
  });
}

function writeEvent(reply: FastifyReply, event: string, data: unknown) {
  return writeRaw(reply, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function abortWithRequest(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortIfResponseIncomplete = () => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", abortIfResponseIncomplete);
  return {
    signal: controller.signal,
    cleanup() {
      request.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", abortIfResponseIncomplete);
    }
  };
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Request aborted.", "AbortError");
}

export async function registerChatRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  overrides: Partial<ChatRouteDependencies> = {}
) {
  const dependencies: ChatRouteDependencies = {
    answerChat,
    deleteChatSession,
    listChatSessions,
    saveChatExchange,
    ...overrides
  };

  app.get<{
    Querystring: { workspaceSlug?: string; limit?: number; offset?: number };
  }>("/api/chat/sessions", { schema: { querystring: sessionQuerySchema } }, async (request, reply) => {
    try {
      return await dependencies.listChatSessions(
        config,
        request.query.workspaceSlug || defaultWorkspaceSlug,
        { limit: request.query.limit ?? 50, offset: request.query.offset ?? 0 }
      );
    } catch (error) {
      return handleError(app, reply, error);
    }
  });

  app.delete<{
    Params: { sessionId: string };
    Querystring: { workspaceSlug?: string };
  }>("/api/chat/sessions/:sessionId", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["sessionId"],
        properties: { sessionId: sessionIdSchema }
      },
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { workspaceSlug: workspaceSlugSchema }
      }
    }
  }, async (request, reply) => {
    try {
      return await dependencies.deleteChatSession(config, {
        workspaceSlug: request.query.workspaceSlug || defaultWorkspaceSlug,
        sessionId: request.params.sessionId
      });
    } catch (error) {
      return handleError(app, reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
      message: string;
      sessionId?: string;
      answerLength?: ChatAnswerLength;
      stream?: boolean;
    };
  }>("/api/chat", {
    schema: { body: chatBodySchema },
    preValidation: async (request, reply) => {
      const validationError = validateChatBody(request.body);
      if (validationError) return reply.code(400).send({ error: validationError });
    }
  }, async (request, reply) => {
    const message = request.body.message.trim();
    if (!message) return reply.code(400).send({ error: "Message is required." });

    const workspaceSlug = request.body.workspaceSlug || defaultWorkspaceSlug;
    const requestAbort = abortWithRequest(request, reply);
    let heartbeat: NodeJS.Timeout | undefined;

    try {
      if (request.body.stream) {
        reply.hijack();
        const sharedHeaders: Record<string, string | number | string[]> = {};
        for (const [name, value] of Object.entries(reply.getHeaders())) {
          if (value !== undefined) sharedHeaders[name] = value;
        }
        reply.raw.writeHead(200, {
          ...sharedHeaders,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        reply.raw.flushHeaders?.();
        await writeRaw(reply, ": connected\n\n");
        await writeEvent(reply, "status", "Kaynaklar aranıyor ve yanıt hazırlanıyor…");

        heartbeat = setInterval(() => {
          void writeRaw(reply, ": working\n\n");
        }, 15_000);

        const response = await dependencies.answerChat(config, {
          workspaceSlug,
          message,
          answerLength: request.body.answerLength,
          signal: requestAbort.signal,
          onProgress: async (progress) => {
            await writeEvent(reply, "progress", progress);
          }
        });
        throwIfAborted(requestAbort.signal);

        await writeEvent(reply, "status", "Yanıt ve kullanılan kaynaklar kaydediliyor…");
        await writeEvent(reply, "progress", { stage: "persist" });
        const { sessionId } = await dependencies.saveChatExchange(config, {
          workspaceSlug,
          sessionId: request.body.sessionId,
          message,
          response
        });
        throwIfAborted(requestAbort.signal);

        // Only verified output reaches the client. We retain the SSE protocol by
        // chunking the final answer after citation and groundedness validation.
        await writeEvent(reply, "status", "Yanıt gönderiliyor…");
        await writeEvent(reply, "progress", { stage: "deliver" });
        if (!await writeEvent(reply, "meta", { ...response, answer: "" })) return;
        for (const chunk of response.answer.match(/[\s\S]{1,80}/g) ?? []) {
          if (!await writeEvent(reply, "token", chunk)) return;
        }
        await writeEvent(reply, "done", { ...response, sessionId });
        if (canWrite(reply)) reply.raw.end();
        return;
      }

      const response = await dependencies.answerChat(config, {
        workspaceSlug,
        message,
        answerLength: request.body.answerLength,
        signal: requestAbort.signal
      });
      throwIfAborted(requestAbort.signal);
      const { sessionId } = await dependencies.saveChatExchange(config, {
        workspaceSlug,
        sessionId: request.body.sessionId,
        message,
        response
      });
      throwIfAborted(requestAbort.signal);
      return { ...response, sessionId };
    } catch (error) {
      if (isAbortError(error) && requestAbort.signal.aborted) return reply;
      if (reply.raw.headersSent) {
        app.log.error(error, "Chat stream failed");
        if (canWrite(reply) && !requestAbort.signal.aborted) {
          await writeEvent(reply, "error", publicError(error).message);
          if (canWrite(reply)) reply.raw.end();
        }
        return;
      }
      return handleError(app, reply, error);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      requestAbort.cleanup();
    }
  });
}
