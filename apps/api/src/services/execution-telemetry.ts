import { and, desc, eq } from "drizzle-orm";
import { createDatabaseClient, queryExecutions, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";

export async function listExecutionTelemetry(
  config: ApiConfig,
  workspaceSlugInput: string,
  limit = 50
) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit || 50)));
    const rows = await client.db.select({
      id: queryExecutions.id,
      queryHash: queryExecutions.queryHash,
      intent: queryExecutions.intent,
      strategy: queryExecutions.strategy,
      plan: queryExecutions.planJson,
      estimatedRows: queryExecutions.estimatedRows,
      actualRows: queryExecutions.actualRows,
      planningMs: queryExecutions.planningMs,
      executionMs: queryExecutions.executionMs,
      fallbackUsed: queryExecutions.fallbackUsed,
      createdAt: queryExecutions.createdAt
    }).from(queryExecutions)
      .innerJoin(workspaces, eq(workspaces.id, queryExecutions.workspaceId))
      .where(and(eq(workspaces.slug, slug), eq(queryExecutions.workspaceId, workspaces.id)))
      .orderBy(desc(queryExecutions.createdAt))
      .limit(boundedLimit);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  } finally {
    await client.close();
  }
}
