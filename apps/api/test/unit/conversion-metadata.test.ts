import assert from "node:assert/strict";
import test from "node:test";
import {
  groundMetadataInDocument,
  hasSubstantiveDocumentContent,
  metadataBatchConcurrency,
  metadataMaximumCharacters,
  preserveOnlySourceNotes,
  sourceOriginalFromConvertedName
} from "../../src/services/conversions.js";

test("split conversion names resolve to the original Word filename", () => {
  assert.equal(sourceOriginalFromConvertedName("merter-d-f34a645a--d-1-a.md"), "merter-d.docx");
  assert.equal(sourceOriginalFromConvertedName("merter-d-f34a645a.md"), "merter-d.docx");
});

test("API metadata models use larger documents and bounded concurrency", () => {
  assert.equal(metadataMaximumCharacters("openai/gpt-5-mini"), 24_000);
  assert.equal(metadataMaximumCharacters("anthropic/claude-sonnet"), 24_000);
  assert.equal(metadataMaximumCharacters("qwen3:4b"), 12_000);
  assert.equal(metadataBatchConcurrency("openai/gpt-5-mini"), 4);
  assert.equal(metadataBatchConcurrency("qwen3:4b"), 1);
});

test("metadata grounding removes invented values and scalarizes classifications", () => {
  const grounded = groundMetadataInDocument({
    title: "D-1/a",
    document_type: ["senet", "sened"],
    date: "1927-08-21",
    date_text: ["21 Ağustos 1927", "21 Ağustos 1927; sene 1329"],
    people: ["Beykozlu Hacı Ali Bey", "Mehmed Varaka"],
    case_numbers: ["Yevmiye Numrosu: 15693"],
    notes: ["birinci not", "ikinci not"]
  }, `## D-1/a

Yevmiye Numrosu : 15693
Beykozlu Hacı Ali Bey
21 Ağustos 1927 ve sene 1329`);

  assert.deepEqual(grounded, {
    title: "D-1/a",
    document_type: "senet",
    date: "1927-08-21",
    date_text: "21 Ağustos 1927",
    people: ["Beykozlu Hacı Ali Bey"],
    case_numbers: ["Yevmiye Numrosu: 15693"],
    notes: "birinci not"
  });
});

test("metadata grounding keeps one contextual representation of repeated identifiers", () => {
  const grounded = groundMetadataInDocument({
    registry_numbers: ["15693", "Yevmiye Numrosu: 15693", "Yevmiye Numrosu: 15693"],
    people: ["Ali Bey", "Ali Bey"]
  }, `Yevmiye Numrosu : 15693\nAli Bey`);

  assert.deepEqual(grounded, {
    registry_numbers: ["Yevmiye Numrosu: 15693"],
    people: ["Ali Bey"]
  });
});

test("placeholder-only documents retain only a source-verbatim note", () => {
  const source = "## C-3/j\n\n**\\[Unreadable document\\]**\n";
  assert.equal(hasSubstantiveDocumentContent(source), false);
  assert.equal(hasSubstantiveDocumentContent("## C-3/k\n\nA short real telegram."), true);
  assert.deepEqual(preserveOnlySourceNotes({
    language: "tr",
    document_type: "document",
    keywords: ["document", "unreadable"],
    summary: "The document cannot be read.",
    notes: "Unreadable document"
  }, source), {
    notes: "Unreadable document"
  });
});
