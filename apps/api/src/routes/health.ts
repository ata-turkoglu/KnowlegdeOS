import type { FastifyInstance } from "fastify";
import { checkDatabaseConnection } from "@knowledgeos/database";
import { checkOllamaHealth } from "@knowledgeos/ai";
import type { ApiConfig } from "../config/env.js";
import { ensureStorageRoot } from "../services/storage.js";

export async function registerHealthRoutes(app: FastifyInstance, config: ApiConfig) {
  app.get("/api/health", async () => ({
    ok: true,
    service: "knowledgeos-api"
  }));

  app.get("/api/health/database", async () => {
    try {
      const connected = await checkDatabaseConnection(config.databaseUrl);

      return {
        ok: connected,
        service: "postgresql"
      };
    } catch (error) {
      app.log.warn({ error }, "Database health check failed");

      return {
        ok: false,
        service: "postgresql"
      };
    }
  });

  app.get("/api/health/storage", async () => {
    try {
      const storageRoot = await ensureStorageRoot(config.storageRoot);

      return {
        ok: true,
        service: "local-storage",
        storageRoot
      };
    } catch (error) {
      app.log.warn({ error }, "Storage health check failed");

      return {
        ok: false,
        service: "local-storage"
      };
    }
  });

  app.get("/api/health/ollama", async () => {
    try {
      const connected = await checkOllamaHealth(config.ollamaBaseUrl);

      return {
        ok: connected,
        service: "ollama",
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaLlmModel
      };
    } catch (error) {
      app.log.warn({ error }, "Ollama health check failed");

      return {
        ok: false,
        service: "ollama",
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaLlmModel
      };
    }
  });
}
