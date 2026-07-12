import { normalizeForSearch } from "./normalize.js";

export type DocumentChunk = {
  chunkIndex: number;
  heading: string | null;
  content: string;
  normalizedContent: string;
  tokenCount: number;
};

export function chunkMarkdown(content: string, targetWords = 420): DocumentChunk[] {
  const sections = splitSections(content);
  const chunks: DocumentChunk[] = [];

  for (const section of sections) {
    const words = section.content.split(/\s+/).filter(Boolean);

    for (let start = 0; start < words.length; start += targetWords) {
      const contentSlice = words.slice(start, start + targetWords).join(" ");
      chunks.push({
        chunkIndex: chunks.length,
        heading: section.heading,
        content: contentSlice,
        normalizedContent: normalizeForSearch(contentSlice),
        tokenCount: Math.ceil(words.length * 1.35)
      });
    }
  }

  if (chunks.length === 0 && content.trim()) {
    chunks.push({
      chunkIndex: 0,
      heading: null,
      content: content.trim(),
      normalizedContent: normalizeForSearch(content),
      tokenCount: Math.ceil(content.split(/\s+/).filter(Boolean).length * 1.35)
    });
  }

  return chunks;
}

function splitSections(content: string) {
  const lines = content.split("\n");
  const sections: Array<{ heading: string | null; content: string }> = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  function flush() {
    const sectionContent = buffer.join("\n").trim();

    if (sectionContent) {
      sections.push({
        heading,
        content: sectionContent
      });
    }

    buffer = [];
  }

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line) || /^\[Sayfa\s+\d+\]/i.test(line.trim())) {
      flush();
      heading = line.replace(/^#{1,6}\s+/, "").trim();
      continue;
    }

    buffer.push(line);
  }

  flush();
  return sections;
}
