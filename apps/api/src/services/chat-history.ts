import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  chatMessages,
  chatSessions,
  createDatabaseClient,
  workspaces,
  type DatabaseClient
} from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import type { ChatResponse } from "./chat.js";

type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  queryType: string | null;
  sources: ChatResponse["sources"];
};

export type StoredChatSession = {
  id: string;
  title: string;
  messages: StoredMessage[];
};

async function withDatabase<T>(config: ApiConfig, operation: (db: DatabaseClient["db"]) => Promise<T>) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    return await operation(client.db);
  } finally {
    await client.close();
  }
}

async function workspaceIdForSlug(db: DatabaseClient["db"], workspaceSlug: string) {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1);
  if (!workspace) throw new HttpError(404, "Workspace not found.");
  return workspace.id;
}

function asSources(value: unknown): ChatResponse["sources"] {
  return Array.isArray(value) ? value as ChatResponse["sources"] : [];
}

export async function listChatSessions(config: ApiConfig, workspaceSlug: string): Promise<StoredChatSession[]> {
  return withDatabase(config, async (db) => {
    const workspaceId = await workspaceIdForSlug(db, workspaceSlug);
    const sessions = await db.select().from(chatSessions)
      .where(eq(chatSessions.workspaceId, workspaceId))
      .orderBy(desc(chatSessions.updatedAt));
    if (sessions.length === 0) return [];

    const messages = await db.select().from(chatMessages)
      .where(inArray(chatMessages.sessionId, sessions.map((session) => session.id)))
      .orderBy(asc(chatMessages.createdAt));

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      messages: messages
        .filter((message) => message.sessionId === session.id)
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          queryType: message.queryType,
          sources: asSources(message.sourcesJson)
        }))
    }));
  });
}

export async function saveChatExchange(
  config: ApiConfig,
  input: { workspaceSlug: string; sessionId?: string; message: string; response: ChatResponse }
) {
  return withDatabase(config, async (db) => {
    const workspaceId = await workspaceIdForSlug(db, input.workspaceSlug);
    let sessionId = input.sessionId;

    if (sessionId) {
      const [session] = await db.select({ id: chatSessions.id }).from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.workspaceId, workspaceId))).limit(1);
      if (!session) throw new HttpError(404, "Chat session not found.");
    } else {
      const [session] = await db.insert(chatSessions).values({
        workspaceId,
        title: input.message.slice(0, 100)
      }).returning({ id: chatSessions.id });
      sessionId = session.id;
    }

    await db.insert(chatMessages).values([
      { sessionId, role: "user", content: input.message },
      {
        sessionId,
        role: "assistant",
        content: input.response.answer,
        queryType: input.response.queryType,
        sourcesJson: input.response.sources
      }
    ]);
    await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
    return { sessionId };
  });
}

export async function deleteChatSession(
  config: ApiConfig,
  input: { workspaceSlug: string; sessionId: string }
) {
  return withDatabase(config, async (db) => {
    const workspaceId = await workspaceIdForSlug(db, input.workspaceSlug);
    const [session] = await db.select({ id: chatSessions.id }).from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.workspaceId, workspaceId))).limit(1);
    if (!session) throw new HttpError(404, "Chat session not found.");

    await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
    return { deleted: true, sessionId: session.id };
  });
}
