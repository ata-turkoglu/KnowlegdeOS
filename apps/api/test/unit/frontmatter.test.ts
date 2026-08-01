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
