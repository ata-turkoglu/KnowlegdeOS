import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config/env.js";
import { isHttpError } from "../lib/http-errors.js";
import { answerChat } from "../services/chat.js";

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
  app.post<{
    Body: {
      workspaceSlug?: string;
      message?: string;
    };
  }>("/api/chat", async (request, reply) => {
    try {
      const message = request.body?.message?.trim();

      if (!message) {
        return reply.code(400).send({
          error: "Message is required."
        });
      }

      return await answerChat(config, {
        workspaceSlug: request.body?.workspaceSlug || "merter-arsivi",
        message
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });
}
