import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  chatMessages,
  chatSessions,
  createDatabaseClient,
  queryExecutions,
  workspaces,
  type DatabaseClient
} from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import type { ChatResponse } from "./chat.js";

export type StoredChatMessage = {
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
  messages: StoredChatMessage[];
};

export type ChatSessionPage = {
  sessions: StoredChatSession[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
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

/**
 * PostgreSQL assigns the same default timestamp to both rows of a single
 * exchange. Keep historical exchanges deterministic by putting the question
 * before its answer when that happens.
 */
export function orderChatMessages(messages: StoredChatMessage[]) {
  const roleOrder: Record<StoredChatMessage["role"], number> = { user: 0, assistant: 1, system: 2 };
  return [...messages].sort((left, right) => {
    const timeOrder = left.createdAt.localeCompare(right.createdAt);
    if (timeOrder !== 0) return timeOrder;
    const messageRoleOrder = roleOrder[left.role] - roleOrder[right.role];
    if (messageRoleOrder !== 0) return messageRoleOrder;
    return left.id.localeCompare(right.id);
  });
}

export async function listChatSessions(
  config: ApiConfig,
  workspaceSlug: string,
  pagination: { limit: number; offset: number }
): Promise<ChatSessionPage> {
  return withDatabase(config, async (db) => {
    const workspaceId = await workspaceIdForSlug(db, workspaceSlug);
    const sessionRows = await db.select().from(chatSessions)
      .where(eq(chatSessions.workspaceId, workspaceId))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = sessionRows.length > pagination.limit;
    const sessions = sessionRows.slice(0, pagination.limit);
    if (sessions.length === 0) {
      return { sessions: [], pagination: { ...pagination, hasMore: false } };
    }

    const messages = await db.select().from(chatMessages)
      .where(inArray(chatMessages.sessionId, sessions.map((session) => session.id)))
      .orderBy(asc(chatMessages.createdAt));

    const messagesBySession = new Map<string, StoredChatMessage[]>();
    for (const message of messages) {
      const storedMessage: StoredChatMessage = {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        queryType: message.queryType,
        sources: asSources(message.sourcesJson)
      };
      const sessionMessages = messagesBySession.get(message.sessionId);
      if (sessionMessages) sessionMessages.push(storedMessage);
      else messagesBySession.set(message.sessionId, [storedMessage]);
    }

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        messages: orderChatMessages(messagesBySession.get(session.id) ?? [])
      })),
      pagination: { ...pagination, hasMore }
    };
  });
}

export async function getChatSessionMessages(config: ApiConfig, input: { workspaceSlug: string; sessionId: string; limit?: number }): Promise<StoredChatMessage[]> {
  return withDatabase(config, async (db) => {
    const workspaceId = await workspaceIdForSlug(db, input.workspaceSlug);
    const [session] = await db.select({ id: chatSessions.id }).from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.workspaceId, workspaceId))).limit(1);
    if (!session) throw new HttpError(404, "Chat session not found.");
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, session.id)).orderBy(desc(chatMessages.createdAt)).limit(input.limit ?? 16);
    return orderChatMessages(rows.reverse().map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt.toISOString(), queryType: message.queryType, sources: asSources(message.sourcesJson) })));
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

    const userMessageCreatedAt = new Date();
    const assistantMessageCreatedAt = new Date(userMessageCreatedAt.getTime() + 1);
    await db.insert(chatMessages).values([
      { sessionId, role: "user", content: input.message, createdAt: userMessageCreatedAt },
      {
        sessionId,
        role: "assistant",
        content: input.response.answer,
        queryType: input.response.queryType,
        sourcesJson: input.response.sources,
        createdAt: assistantMessageCreatedAt
      }
    ]);
    await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
    await db.insert(queryExecutions).values({
      workspaceId,
      queryHash: createHash("sha256").update(input.message).digest("hex"),
      intent: input.response.analysis.intent,
      strategy: input.response.executionPlan.strategy,
      planJson: {
        ...input.response.executionPlan,
        nodes: input.response.executionPlan.nodes.map(({ query: _query, ...node }) => node)
      },
      estimatedRows: input.response.executionTelemetry.estimatedRows,
      actualRows: input.response.executionTelemetry.actualRows,
      planningMs: input.response.executionTelemetry.planningMs,
      executionMs: input.response.executionTelemetry.executionMs,
      fallbackUsed: input.response.analysis.fallbackUsed
    });
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
