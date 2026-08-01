import { relations, sql } from "drizzle-orm";
import {
  boolean,
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

export const entityAliasSourceEnum = pgEnum("entity_alias_source", [
  "LLM",
  "REGEX",
  "FRONTMATTER",
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
    contentHash: text("content_hash").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    // bge-m3 (the configured default) emits 1024 dimensions.
    embedding: vector("embedding", { dimensions: 1024 }),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    documentIdIdx: index("document_chunks_document_id_idx").on(table.documentId),
    contentHashIdx: index("document_chunks_content_hash_idx").on(table.contentHash),
    documentChunkUnique: unique("document_chunks_document_chunk_index_unique").on(
      table.documentId,
      table.chunkIndex
    )
  })
);

export const workspaceFields = pgTable(
  "workspace_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    valueType: text("value_type").notNull().default("TEXT"),
    filterable: boolean("filterable").notNull().default(true),
    entityEnabled: boolean("entity_enabled").notNull().default(true),
    searchable: boolean("searchable").notNull().default(true),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    ...timestamps
  },
  (table) => ({
    workspaceIdIdx: index("workspace_fields_workspace_id_idx").on(table.workspaceId),
    workspaceKeyUnique: uniqueIndex("workspace_fields_workspace_key_unique").on(
      table.workspaceId,
      table.key
    )
  })
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => workspaceFields.id, { onDelete: "cascade" }),
    canonicalValue: text("canonical_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    ...timestamps
  },
  (table) => ({
    fieldIdIdx: index("entities_field_id_idx").on(table.fieldId),
    entityUnique: uniqueIndex("entities_field_normalized_unique").on(
      table.fieldId,
      table.normalizedValue
    )
  })
);

export const documentFieldValues = pgTable(
  "document_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => workspaceFields.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull().default(0),
    textValue: text("text_value"),
    normalizedValue: text("normalized_value"),
    dateValue: date("date_value"),
    numberValue: real("number_value"),
    booleanValue: boolean("boolean_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    documentIdIdx: index("document_field_values_document_id_idx").on(table.documentId),
    fieldIdIdx: index("document_field_values_field_id_idx").on(table.fieldId),
    normalizedValueIdx: index("document_field_values_normalized_value_idx").on(table.normalizedValue),
    documentFieldOrdinalUnique: uniqueIndex("document_field_values_document_field_ordinal_unique").on(
      table.documentId,
      table.fieldId,
      table.ordinal
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
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    provider: text("provider"),
    model: text("model"),
    evidenceSnippet: text("evidence_snippet"),
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
    mentionCount: integer("mention_count").notNull().default(0),
    maxChunkMentions: integer("max_chunk_mentions").notNull().default(0),
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: real("confidence").notNull().default(1),
    source: text("source").notNull().default("FRONTMATTER"),
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

export const chunkEntities = pgTable(
  "chunk_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    mentionCount: integer("mention_count").notNull().default(1),
    firstOffset: integer("first_offset"),
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: real("confidence").notNull().default(1),
    source: text("source").notNull().default("TEXT_MATCH"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    chunkIdIdx: index("chunk_entities_chunk_id_idx").on(table.chunkId),
    entityIdIdx: index("chunk_entities_entity_id_idx").on(table.entityId),
    chunkEntityUnique: uniqueIndex("chunk_entities_chunk_entity_unique").on(table.chunkId, table.entityId)
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
    chunkId: uuid("chunk_id").references(() => documentChunks.id, {
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
    /** Semantic relationship provenance. Co-occurrence is derived at runtime. */
    origin: text("origin").notNull().default("LLM"),
    provider: text("provider"),
    model: text("model"),
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

/** A source-grounded statement or event. Unlike entity-to-entity graph edges,
 * claims may carry a literal object and a temporal interval. */
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => documentChunks.id, { onDelete: "set null" }),
    subjectEntityId: uuid("subject_entity_id").references(() => entities.id, { onDelete: "set null" }),
    subjectText: text("subject_text").notNull(),
    predicate: text("predicate").notNull(),
    objectEntityId: uuid("object_entity_id").references(() => entities.id, { onDelete: "set null" }),
    objectText: text("object_text").notNull(),
    eventDate: date("event_date"),
    eventDateStart: date("event_date_start"),
    eventDateEnd: date("event_date_end"),
    dateText: text("date_text"),
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: real("confidence").notNull().default(0.8),
    origin: text("origin").notNull().default("LLM"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    workspaceIdIdx: index("claims_workspace_id_idx").on(table.workspaceId),
    documentIdIdx: index("claims_document_id_idx").on(table.documentId),
    subjectEntityIdIdx: index("claims_subject_entity_id_idx").on(table.subjectEntityId),
    predicateIdx: index("claims_predicate_idx").on(table.predicate),
    eventDateIdx: index("claims_event_date_idx").on(table.eventDate)
  })
);

export const propertyReferences = pgTable(
  "property_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    place: text("place"),
    normalizedPlace: text("normalized_place"),
    sheet: text("sheet"),
    block: text("block"),
    parcel: text("parcel").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: real("confidence").notNull().default(1),
    source: entityAliasSourceEnum("source").notNull().default("REGEX"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    workspaceIdIdx: index("property_references_workspace_id_idx").on(table.workspaceId),
    documentIdIdx: index("property_references_document_id_idx").on(table.documentId),
    normalizedKeyIdx: index("property_references_normalized_key_idx").on(table.normalizedKey),
    documentKeyUnique: uniqueIndex("property_references_document_key_unique").on(
      table.documentId,
      table.normalizedKey
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

export const queryExecutions = pgTable(
  "query_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    queryHash: text("query_hash").notNull(),
    intent: text("intent").notNull(),
    strategy: text("strategy").notNull(),
    planJson: jsonb("plan_json").notNull(),
    estimatedRows: integer("estimated_rows").notNull().default(0),
    actualRows: integer("actual_rows").notNull().default(0),
    planningMs: real("planning_ms").notNull().default(0),
    executionMs: real("execution_ms").notNull().default(0),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    workspaceCreatedIdx: index("query_executions_workspace_created_idx").on(table.workspaceId, table.createdAt),
    queryHashIdx: index("query_executions_query_hash_idx").on(table.queryHash)
  })
);

export const workspaceRelations = relations(workspaces, ({ many }) => ({
  documents: many(documents),
  fields: many(workspaceFields),
  chatSessions: many(chatSessions),
  queryExecutions: many(queryExecutions)
}));

export const workspaceFieldRelations = relations(workspaceFields, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workspaceFields.workspaceId],
    references: [workspaces.id]
  }),
  entities: many(entities)
}));

export const documentRelations = relations(documents, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [documents.workspaceId],
    references: [workspaces.id]
  }),
  chunks: many(documentChunks),
  documentEntities: many(documentEntities),
  documentFieldValues: many(documentFieldValues),
  propertyReferences: many(propertyReferences)
}));

export const entityRelations = relations(entities, ({ one, many }) => ({
  field: one(workspaceFields, {
    fields: [entities.fieldId],
    references: [workspaceFields.id]
  }),
  aliases: many(entityAliases),
  documentEntities: many(documentEntities),
  chunkEntities: many(chunkEntities)
}));
