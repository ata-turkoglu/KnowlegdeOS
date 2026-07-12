import type { FastifyInstance } from "fastify";
import { ocrMarkdownPrompt } from "@knowledgeos/ai";

export async function registerPromptRoutes(app: FastifyInstance) {
  app.get("/api/prompts/ocr-markdown", async () => ({
    prompt: ocrMarkdownPrompt
  }));
}
