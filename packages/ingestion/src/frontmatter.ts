import type { MetadataScalar, MetadataValue } from '@knowledgeos/shared';

export type ParsedMarkdown = {
  frontmatter: Record<string, MetadataValue>;
  content: string;
};

export function parseMarkdownFrontmatter(markdown: string): ParsedMarkdown {
  const input = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const opening = input.match(/^---\r?\n/);
  if (!opening) {
    return {
      frontmatter: {},
      content: markdown
    };
  }

  const closing = /\r?\n---(?:\r?\n|$)/g;
  closing.lastIndex = opening[0].length;
  const closingMatch = closing.exec(input);

  if (!closingMatch) {
    return {
      frontmatter: {},
      content: markdown
    };
  }

  const rawFrontmatter = input.slice(opening[0].length, closingMatch.index).replace(/\r\n/g, "\n").trim();
  const content = input.slice(closingMatch.index + closingMatch[0].length).trim();

  return {
    frontmatter: parseSimpleYaml(rawFrontmatter),
    content
  };
}

function parseSimpleYaml(input: string) {
  const result: Record<string, MetadataValue> = {};
  const lines = input.split("\n");
  let currentArrayKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (currentArrayKey && trimmed.startsWith("- ")) {
      const existing = result[currentArrayKey];
      const value = parseScalar(trimmed.slice(2).trim());
      result[currentArrayKey] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      continue;
    }

    currentArrayKey = null;
    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (value === "[]") {
      result[key] = [];
      currentArrayKey = key;
      continue;
    }

    if (!value) {
      result[key] = [];
      currentArrayKey = key;
      continue;
    }

    result[key] = parseScalar(value);
  }

  return result;
}

function parseScalar(value: string): MetadataScalar {
  if (/^["']/.test(value)) return value.replace(/^["']|["']$/g, '');
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(value)) return Number(value);
  return value;
}
