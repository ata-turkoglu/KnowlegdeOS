import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient } from "./client.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/knowledgeos";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(currentDir, "../drizzle");

const client = createDatabaseClient(databaseUrl);

try {
  await migrate(client.db, {
    migrationsFolder
  });
  console.log("Database migrations completed.");
} finally {
  await client.close();
}
