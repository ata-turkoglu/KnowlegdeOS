import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/knowledgeos"
  },
  strict: true,
  verbose: true
});
