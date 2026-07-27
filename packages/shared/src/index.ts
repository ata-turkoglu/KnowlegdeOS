export const entityTypes = [
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
] as const;

export type EntityType = (typeof entityTypes)[number];

export type QueryType = "ENTITY_SEARCH" | "SEMANTIC_SEARCH" | "HYBRID_SEARCH";

export type SourceSnippet = {
  documentId: string;
  documentCode?: string;
  title: string;
  evidenceSnippet: string;
};
