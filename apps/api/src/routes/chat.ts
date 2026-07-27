import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { answerChat, prepareChatAnswer, type ChatAnswerLength } from "../services/chat.js";
import { getLlmProvider } from "../services/ai-providers.js";
import { deleteChatSession, listChatSessions, saveChatExchange } from "../services/chat-history.js";

function handleError(app: FastifyInstance, reply: FastifyReply, error: unknown) {
  if (isHttpError(error)) {
    return reply.code(error.statusCode).send({
      error: error.message
    });
  }

  app.log.error(error, "Chat request failed");
  const message = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = error instanceof DOMException && error.name === "AbortError";
  return reply.code(502).send({
    error: isTimeout
      ? "Ollama yanıt üretirken zaman aşımına uğradı. Daha kısa bir soru deneyin veya model zaman aşımını artırın."
      : `Sohbet yanıtı üretilemedi: ${message.slice(0, 500)}`
  });
}

function writeEvent(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chatErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = error instanceof DOMException && error.name === "AbortError";
  return isTimeout
    ? "Model yan\u0131t \u00fcretirken zaman a\u015f\u0131m\u0131na u\u011frad\u0131. Daha k\u0131sa bir soru deneyin veya model zaman a\u015f\u0131m\u0131n\u0131 art\u0131r\u0131n."
    : `Sohbet yan\u0131t\u0131 \u00fcretilemedi: ${message.slice(0, 500)}`;
}

export async function registerChatRoutes(app: FastifyInstance, config: ApiConfig) {
  app.get<{ Querystring: { workspaceSlug?: string } }>("/api/chat/sessions", async (request, reply) => {
    try {
      return await listChatSessions(config, request.query.workspaceSlug || "merter-arsivi");
    } catch (error) {
      return handleError(app, reply, error);
    }
  });

  app.delete<{
    Params: { sessionId: string };
    Querystring: { workspaceSlug?: string };
  }>("/api/chat/sessions/:sessionId", async (request, reply) => {
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

      if (!message) {
        return reply.code(400).send({
          error: "Message is required."
        });
      }

      const workspaceSlug = request.body?.workspaceSlug || "merter-arsivi";
      if (request.body?.stream) {
        // Begin the stream before semantic search. A cold embedding model can take
        // longer than a browser/proxy is willing to wait for response headers.
        reply.hijack();
        const origin = request.headers.origin;
        const allowedOrigin = origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"
          ? origin
          : "http://localhost:3000";
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
        const prepared = await prepareChatAnswer(config, { workspaceSlug, message });
        writeEvent(reply, "status", "Kaynaklar aranıyor…");
        writeEvent(reply, "meta", prepared.response);
        let answer = prepared.response.answer;
        if (prepared.prompt) {
          for await (const chunk of getLlmProvider(config, "answer").generateStream(prepared.prompt, undefined, {
            maxOutputTokens: request.body?.answerLength === "detailed" ? 3000 : 1024
          })) {
            answer += chunk;
            writeEvent(reply, "token", chunk);
          }
        }
        const response = { ...prepared.response, answer: answer.trim() || "Model kaynaklara dayalı bir yanıt üretemedi." };
        const { sessionId } = await saveChatExchange(config, { workspaceSlug, sessionId: request.body?.sessionId, message, response });
        writeEvent(reply, "done", { ...response, sessionId });
        reply.raw.end();
        return;
      }
      const response = await answerChat(config, {
        workspaceSlug,
        message,
        answerLength: request.body?.answerLength
      });
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
