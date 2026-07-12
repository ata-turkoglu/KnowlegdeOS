import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { answerChat } from "../services/chat.js";
import { deleteChatSession, listChatSessions, saveChatExchange } from "../services/chat-history.js";

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

export async function registerChatRoutes(app: FastifyInstance, config: ApiConfig) {
  app.get<{ Querystring: { workspaceSlug?: string } }>("/api/chat/sessions", async (request, reply) => {
    try {
      return await listChatSessions(config, request.query.workspaceSlug || "merter-arsivi");
    } catch (error) {
      return handleError(reply, error);
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
      return handleError(reply, error);
    }
  });

  app.post<{
    Body: {
      workspaceSlug?: string;
      message?: string;
      sessionId?: string;
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
      const response = await answerChat(config, {
        workspaceSlug,
        message
      });
      const { sessionId } = await saveChatExchange(config, {
        workspaceSlug,
        sessionId: request.body?.sessionId,
        message,
        response
      });

      return { ...response, sessionId };
    } catch (error) {
      return handleError(reply, error);
    }
  });
}
