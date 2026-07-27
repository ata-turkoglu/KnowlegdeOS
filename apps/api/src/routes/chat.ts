import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { answerChat, type ChatAnswerLength } from "../services/chat.js";
import { deleteChatSession, listChatSessions, saveChatExchange } from "../services/chat-history.js";

function handleError(app: FastifyInstance, reply: FastifyReply, error: unknown) {
  if (isHttpError(error)) return reply.code(error.statusCode).send({ error: error.message });
  app.log.error(error, "Chat request failed");
  const message = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = error instanceof DOMException && error.name === "AbortError";
  return reply.code(502).send({
    error: isTimeout
      ? "Model yanıt üretimi iptal edildi."
      : `Sohbet yanıtı üretilemedi: ${message.slice(0, 500)}`
  });
}

function writeEvent(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chatErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const isAbort = error instanceof DOMException && error.name === "AbortError";
  return isAbort ? "Model yanıt üretimi iptal edildi." : `Sohbet yanıtı üretilemedi: ${message.slice(0, 500)}`;
}

export async function registerChatRoutes(app: FastifyInstance, config: ApiConfig) {
  app.get<{ Querystring: { workspaceSlug?: string } }>("/api/chat/sessions", async (request, reply) => {
    try {
      return await listChatSessions(config, request.query.workspaceSlug || "merter-arsivi");
    } catch (error) {
      return handleError(app, reply, error);
    }
  });

  app.delete<{ Params: { sessionId: string }; Querystring: { workspaceSlug?: string } }>("/api/chat/sessions/:sessionId", async (request, reply) => {
    try {
      return await deleteChatSession(config, {
        workspaceSlug: request.query.workspaceSlug || "merter-arsivi",
        sessionId: request.params.sessionId
      });
    } catch (error) {
      return handleError(app, reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
      message?: string;
      sessionId?: string;
      answerLength?: ChatAnswerLength;
      stream?: boolean;
    };
  }>("/api/chat", async (request, reply) => {
    try {
      const message = request.body?.message?.trim();
      if (!message) return reply.code(400).send({ error: "Message is required." });

      const workspaceSlug = request.body?.workspaceSlug || "merter-arsivi";
      if (request.body?.stream) {
        reply.hijack();
        const origin = request.headers.origin;
        const allowedOrigin = origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000" ? origin : "http://localhost:3000";
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": allowedOrigin,
          Vary: "Origin"
        });
        reply.raw.flushHeaders?.();
        reply.raw.write(": connected\n\n");
        writeEvent(reply, "status", "Kaynaklar aranıyor…");

        const controller = new AbortController();
        const abortOnDisconnect = () => controller.abort();
        reply.raw.once("close", abortOnDisconnect);
        const heartbeat = setInterval(() => {
          if (!reply.raw.destroyed) reply.raw.write(": working\n\n");
        }, 15_000);
        let response: Awaited<ReturnType<typeof answerChat>>;
        try {
          response = await answerChat(config, {
            workspaceSlug,
            message,
            answerLength: request.body?.answerLength,
            signal: controller.signal
          });
        } finally {
          clearInterval(heartbeat);
          reply.raw.removeListener("close", abortOnDisconnect);
        }

        // Only verified output reaches the client. We retain the SSE protocol by
        // chunking the final answer after citation and groundedness validation.
        writeEvent(reply, "meta", { ...response, answer: "" });
        for (const chunk of response.answer.match(/[\s\S]{1,80}/g) ?? []) writeEvent(reply, "token", chunk);

        const { sessionId } = await saveChatExchange(config, { workspaceSlug, sessionId: request.body?.sessionId, message, response });
        writeEvent(reply, "done", { ...response, sessionId });
        reply.raw.end();
        return;
      }

      const response = await answerChat(config, { workspaceSlug, message, answerLength: request.body?.answerLength });
      const { sessionId } = await saveChatExchange(config, {
        workspaceSlug,
        sessionId: request.body?.sessionId,
        message,
        response
      });
      return { ...response, sessionId };
    } catch (error) {
      if (reply.raw.headersSent) {
        app.log.error(error, "Chat stream failed");
        writeEvent(reply, "error", chatErrorMessage(error));
        reply.raw.end();
        return;
      }
      return handleError(app, reply, error);
    }
  });
}
