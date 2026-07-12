import { chunkMarkdown } from "./chunk.js";
import { deterministicExtract } from "./extract.js";
import { parseMarkdownFrontmatter } from "./frontmatter.js";
import { normalizeForSearch, normalizeText } from "./normalize.js";

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

export { chunkMarkdown, type DocumentChunk } from "./chunk.js";
export { deterministicExtract, type ExtractedEntity } from "./extract.js";
export { parseMarkdownFrontmatter, type ParsedMarkdown } from "./frontmatter.js";
export { normalizeForSearch, normalizeText } from "./normalize.js";

export type IngestionResult = {
  frontmatter: Record<string, string | string[]>;
  content: string;
  normalizedContent: string;
  chunks: import("./chunk.js").DocumentChunk[];
  entities: import("./extract.js").ExtractedEntity[];
};

export function ingestMarkdown(markdown: string): IngestionResult {
  const parsed = parseMarkdownFrontmatter(normalizeText(markdown));
  const chunks = chunkMarkdown(parsed.content);

  return {
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    normalizedContent: normalizeForSearch(parsed.content),
    chunks,
    entities: deterministicExtract({
      content: parsed.content,
      frontmatter: parsed.frontmatter
    })
  };
}
