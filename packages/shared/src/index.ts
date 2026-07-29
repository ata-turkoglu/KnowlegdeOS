/** Entity kinds are workspace metadata field keys and are resolved at runtime. */
export type EntityType = string;

export type QueryType = "ENTITY_SEARCH" | "SEMANTIC_SEARCH" | "HYBRID_SEARCH";

export type SourceSnippet = {
  documentId: string;
  documentCode?: string;
  title: string;
  evidenceSnippet: string;
};

export { chatWorkflowStages } from "./chat-workflow";
export type { ChatProgress, ChatWorkflowStageId } from "./chat-workflow";
