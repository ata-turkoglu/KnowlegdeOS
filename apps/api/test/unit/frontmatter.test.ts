import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownFrontmatter } from "@knowledgeos/ingestion";

test("frontmatter parser accepts LF, CRLF, and a UTF-8 BOM", () => {
  for (const markdown of [
    "---\ntitle: \"Belge\"\n---\n\nİçerik",
    "---\r\ntitle: \"Belge\"\r\n---\r\n\r\nİçerik",
    "\uFEFF---\r\ntitle: \"Belge\"\r\n---\r\n\r\nİçerik"
  ]) {
    assert.deepEqual(parseMarkdownFrontmatter(markdown), {
      frontmatter: { title: "Belge" },
      content: "İçerik"
    });
  }
});

test("frontmatter parser preserves primitive YAML types", () => {
  const parsed = parseMarkdownFrontmatter("---\namount: 12.5\nverified: true\nlabels:\n  - \"A\"\n  - 2\n---\n\nBody");
  assert.deepEqual(parsed.frontmatter, { amount: 12.5, verified: true, labels: ["A", 2] });
});
