import assert from "node:assert/strict";
import test from "node:test";
import { classifyQuery } from "@knowledgeos/search";
import { extractMetadataFilters, LexicalOverlapReranker, LlmReranker, NoopReranker, reciprocalRankFusion, shouldRetryWithoutMetadata, validateCitations, validateEvidenceValues } from "../../src/services/rag-core.js";

const candidate = (chunkId: string, sourceType: "ENTITY" | "SEMANTIC" | "LEXICAL", score = 1) => ({ documentId: "doc", chunkId, chunkIndex: 0, documentName: "belge", title: "Belge", heading: null, evidenceSnippet: "kanıt", sourceType, score });

test("router deterministically identifies archive question types", () => {
  assert.equal(classifyQuery("Ahmet Yılmaz hangi belgelerde geçiyor?"), "ENTITY_SEARCH");
  assert.equal(classifyQuery("Belgeleri özetle"), "HYBRID_SEARCH");
  assert.equal(classifyQuery("Bu kararın konusu nedir?"), "SEMANTIC_SEARCH");
});
test("metadata extraction preserves exact dates and document type", () => assert.deepEqual(extractMetadataFilters("2024-05-03 tarihli tapu"), { date: "2024-05-03", year: "2024", documentType: "tapu" }));
test("metadata extraction normalizes Turkish accents and avoids generic hard filters", () => {
  assert.deepEqual(extractMetadataFilters("Vekâletname belgesini bul"), { documentType: "vekaletname" });
  assert.deepEqual(extractMetadataFilters("44 numaralı karar nedir?"), {});
  assert.equal(shouldRetryWithoutMetadata({ year: "2024" }, { entity: 0, semantic: 0, lexical: 0 }), true);
  assert.equal(shouldRetryWithoutMetadata({ year: "2024" }, { entity: 0, semantic: 1, lexical: 0 }), false);
});
test("RRF deduplicates candidates and preserves origins", () => { const value = reciprocalRankFusion([[candidate("a", "ENTITY")], [candidate("a", "SEMANTIC"), candidate("b", "LEXICAL")]]); assert.equal(value.length, 2); assert.deepEqual(value[0].retrievers, ["ENTITY", "SEMANTIC"]); });
test("citation validator rejects missing and out-of-range citations", () => { assert.equal(validateCitations("Yanıt [1]", 1, true).valid, true); assert.equal(validateCitations("Yanıt [99]", 1, true).valid, false); assert.equal(validateCitations("Yanıt", 1, true).valid, false); });
test("noop reranker is an offline deterministic baseline", async () => assert.equal((await new NoopReranker().rerank({ query: "x", candidates: [candidate("a", "ENTITY"), candidate("b", "LEXICAL")], topK: 1 })).length, 1));
test("offline reranker promotes evidence sharing query terms", async () => {
  const unrelated = { ...candidate("a", "SEMANTIC"), evidenceSnippet: "başka içerik" };
  const relevant = { ...candidate("b", "LEXICAL"), evidenceSnippet: "192 parsel tapu kaydı" };
  const result = await new LexicalOverlapReranker().rerank({ query: "192 parsel", candidates: [unrelated, relevant], topK: 2 });
  assert.equal(result[0].chunkId, "b");
});
test("LLM reranker validates IDs and falls back on malformed output", async () => {
  const values = [candidate("a", "SEMANTIC"), candidate("b", "LEXICAL")];
  const ranked = await new LlmReranker(async () => ({ rankings: [{ id: "b", score: .95 }, { id: "unknown", score: 1 }] })).rerank({ query: "x", candidates: values, topK: 2 });
  assert.equal(ranked[0].chunkId, "b");
  const fallback = await new LlmReranker(async () => { throw new Error("offline"); }).rerank({ query: "x", candidates: values, topK: 2 });
  assert.equal(fallback.length, 2);
});
test("groundedness guard rejects unsupported numeric values", () => {
  assert.equal(validateEvidenceValues("Parsel 192'dir [1]", ["192 parsel kaydı"]).valid, true);
  assert.deepEqual(validateEvidenceValues("Parsel 999'dur [1]", ["192 parsel kaydı"]).unsupported, ["999"]);
});
