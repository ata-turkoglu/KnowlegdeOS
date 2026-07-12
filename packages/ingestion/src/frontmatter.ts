export type ParsedMarkdown = {
  frontmatter: Record<string, string | string[]>;
  content: string;
};

export function parseMarkdownFrontmatter(markdown: string): ParsedMarkdown {
  if (!markdown.startsWith("---\n")) {
    return {
      frontmatter: {},
      content: markdown
    };
  }

  const closingIndex = markdown.indexOf("\n---", 4);

  if (closingIndex === -1) {
    return {
      frontmatter: {},
      content: markdown
    };
  }

  const rawFrontmatter = markdown.slice(4, closingIndex).trim();
  const content = markdown.slice(closingIndex + 4).trim();

  return {
    frontmatter: parseSimpleYaml(rawFrontmatter),
    content
  };
}

function parseSimpleYaml(input: string) {
  const result: Record<string, string | string[]> = {};
  const lines = input.split("\n");
  let currentArrayKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (currentArrayKey && trimmed.startsWith("- ")) {
      const existing = result[currentArrayKey];
      const value = stripQuotes(trimmed.slice(2).trim());
      result[currentArrayKey] = Array.isArray(existing) ? [...existing, value] : [value];
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

    result[key] = stripQuotes(value);
  }

  return result;
}

function stripQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "");
}
