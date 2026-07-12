import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export function createDatabaseClient(databaseUrl: string) {
  const queryClient = postgres(databaseUrl, {
    max: 10
  });

  return {
    db: drizzle(queryClient, { schema }),
    queryClient,
    async close() {
      await queryClient.end();
    }
  };
}

export async function checkDatabaseConnection(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 3
  });

  try {
    await client`select 1`;
    return true;
  } finally {
    await client.end();
  }
}
