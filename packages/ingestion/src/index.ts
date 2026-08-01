import { chunkMarkdown } from "./chunk.js";
import { deterministicExtract, extractPropertyReferences } from "./extract.js";
import { parseMarkdownFrontmatter } from "./frontmatter.js";
import { normalizeForSearch, normalizeText } from "./normalize.js";
import type { MetadataValue } from '@knowledgeos/shared';

export type IngestionStage =
  | "upload"
  | "normalize"
  | "chunk"
  | "deterministic_extraction"
  | "llm_extraction"
  | "alias_resolution"
  | "embedding";

export const ingestionStages: IngestionStage[] = [
  "upload",
  "normalize",
  "chunk",
  "deterministic_extraction",
  "llm_extraction",
  "alias_resolution",
  "embedding"
];

export { chunkMarkdown, type ChunkOptions, type DocumentChunk } from "./chunk.js";
export { deterministicExtract, extractPropertyReferences, type ExtractedEntity, type ExtractedPropertyReference } from "./extract.js";
export { parseMarkdownFrontmatter, type ParsedMarkdown } from "./frontmatter.js";
export { normalizeForSearch, normalizeText } from "./normalize.js";

export type IngestionResult = {
  frontmatter: Record<string, MetadataValue>;
  content: string;
  normalizedContent: string;
  chunks: import("./chunk.js").DocumentChunk[];
  entities: import("./extract.js").ExtractedEntity[];
  propertyReferences: import("./extract.js").ExtractedPropertyReference[];
};

export function ingestMarkdown(markdown: string, chunkOptions?: import("./chunk.js").ChunkOptions, fallbackFrontmatter: Record<string, MetadataValue> = {}): IngestionResult {
  const parsed = parseMarkdownFrontmatter(normalizeText(markdown));
  const frontmatter = Object.keys(parsed.frontmatter).length ? parsed.frontmatter : fallbackFrontmatter;
  const chunks = chunkMarkdown(parsed.content, chunkOptions);

  return {
    frontmatter,
    content: parsed.content,
    normalizedContent: normalizeForSearch(parsed.content),
    chunks,
    entities: deterministicExtract({
      content: parsed.content,
      frontmatter
    }),
    propertyReferences: extractPropertyReferences({
      content: parsed.content,
      frontmatter
    })
  };
}
