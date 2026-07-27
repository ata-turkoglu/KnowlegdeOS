import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector
} from "drizzle-orm/pg-core";

export const entityTypeEnum = pgEnum("entity_type", [
  "PERSON",
  "PLACE",
  "PARCEL",
  "DATE",
  "ORGANIZATION",
  "DOCUMENT_TYPE",
  "CASE_NUMBER",
  "NOTARY_NUMBER",
  "PROPERTY",
  "EVENT",
  "KEYWORD"
]);

export const entityAliasSourceEnum = pgEnum("entity_alias_source", [
  "LLM",
  "REGEX",
  "USER",
  "IMPORT"
]);

export const documentStatusEnum = pgEnum("document_status", [
  "UPLOADED",
  "INDEXING",
  "INDEXED",
  "FAILED"
]);

export const chatRoleEnum = pgEnum("chat_role", [
  "user",
  "assistant",
  "system"
]);

export const queryTypeEnum = pgEnum("query_type", [
  "ENTITY_SEARCH",
  "SEMANTIC_SEARCH",
  "HYBRID_SEARCH"
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  storagePath: text("storage_path").notNull(),
  ...timestamps
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    normalizedContent: text("normalized_content").notNull(),
    sourceOriginalPath: text("source_original_path"),
    markdownPath: text("markdown_path").notNull(),
    summary: text("summary"),
    /** Parsed YAML frontmatter. Keeps source-specific filtering data queryable later. */
    metadata: jsonb("metadata").notNull().default({}),
    ingestionSettings: jsonb("ingestion_settings").notNull().default({}),
    llmExtraction: jsonb("llm_extraction"),
    llmExtractionError: text("llm_extraction_error"),
    embeddingModel: text("embedding_model"),
    documentType: text("document_type"),
    documentDate: date("document_date"),
    status: documentStatusEnum("status").notNull().default("UPLOADED"),
    hash: text("hash").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => ({
    workspaceIdIdx: index("documents_workspace_id_idx").on(table.workspaceId),
    hashIdx: index("documents_hash_idx").on(table.hash)
  })
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    normalizedContent: text("normalized_content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    // bge-m3 (the configured default) emits 1024 dimensions.
    embedding: vector("embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    documentIdIdx: index("document_chunks_document_id_idx").on(table.documentId),
    documentChunkUnique: unique("document_chunks_document_chunk_index_unique").on(
      table.documentId,
      table.chunkIndex
    )
  })
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: entityTypeEnum("type").notNull(),
    canonicalValue: text("canonical_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    ...timestamps
  },
  (table) => ({
    workspaceIdIdx: index("entities_workspace_id_idx").on(table.workspaceId),
    entityUnique: uniqueIndex("entities_workspace_type_normalized_unique").on(
      table.workspaceId,
      table.type,
      table.normalizedValue
    )
  })
);

export const entityAliases = pgTable(
  "entity_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    confidence: real("confidence").notNull().default(1),
    source: entityAliasSourceEnum("source").notNull().default("REGEX"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    entityIdIdx: index("entity_aliases_entity_id_idx").on(table.entityId),
    aliasUnique: uniqueIndex("entity_aliases_entity_normalized_unique").on(
      table.entityId,
      table.normalizedAlias
    )
  })
);

export const documentEntities = pgTable(
  "document_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: real("confidence").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    documentIdIdx: index("document_entities_document_id_idx").on(table.documentId),
    entityIdIdx: index("document_entities_entity_id_idx").on(table.entityId),
    documentEntityUnique: uniqueIndex("document_entities_document_entity_unique").on(
      table.documentId,
      table.entityId
    )
  })
);

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null"
    }),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: real("confidence").notNull().default(1),
    /** RULE = conservative co-occurrence; LLM = extracted semantic relation. */
    origin: text("origin").notNull().default("LLM"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    workspaceIdIdx: index("relationships_workspace_id_idx").on(table.workspaceId),
    sourceEntityIdIdx: index("relationships_source_entity_id_idx").on(
      table.sourceEntityId
    ),
    targetEntityIdIdx: index("relationships_target_entity_id_idx").on(
      table.targetEntityId
    )
  })
);

export const backups = pgTable("backups", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note")
});

export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  filePath: text("file_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestamps
  },
  (table) => ({
    workspaceIdIdx: index("chat_sessions_workspace_id_idx").on(table.workspaceId)
  })
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    queryType: queryTypeEnum("query_type"),
    sourcesJson: jsonb("sources_json").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    sessionIdIdx: index("chat_messages_session_id_idx").on(table.sessionId)
  })
);

export const workspaceRelations = relations(workspaces, ({ many }) => ({
  documents: many(documents),
  entities: many(entities),
  chatSessions: many(chatSessions)
}));

export const documentRelations = relations(documents, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [documents.workspaceId],
    references: [workspaces.id]
  }),
  chunks: many(documentChunks),
  documentEntities: many(documentEntities)
}));

export const entityRelations = relations(entities, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [entities.workspaceId],
    references: [workspaces.id]
  }),
  aliases: many(entityAliases),
  documentEntities: many(documentEntities)
}));
