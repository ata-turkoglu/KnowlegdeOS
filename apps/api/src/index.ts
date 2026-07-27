import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { loadConfig } from "./config/env.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerConversionRoutes } from "./routes/conversions.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";

const config = loadConfig();
const app = Fastify({
  logger: true,
  // YAML extraction with local models can legitimately run for several
  // minutes. Do not let Node's default request deadline terminate it.
  requestTimeout: 0
});

await app.register(cors, {
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"]
});
await app.register(multipart);
await registerHealthRoutes(app, config);
await registerSettingsRoutes(app, config);
await registerDashboardRoutes(app, config);
await registerWorkspaceRoutes(app, config);
await registerDocumentRoutes(app, config);
await registerConversionRoutes(app, config);
await registerEntityRoutes(app, config);
await registerSearchRoutes(app, config);
await registerChatRoutes(app, config);

await app.listen({
  host: config.apiHost,
  port: config.apiPort
});
