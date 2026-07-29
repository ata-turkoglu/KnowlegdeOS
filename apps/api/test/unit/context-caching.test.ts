import assert from "node:assert/strict";
import test from "node:test";
import { flattenGenerationInput } from "@knowledgeos/ai";
import { buildDynamicChatPrompt, buildStableChatPrefix, createContextCacheIdentity, createEvidenceSnippet, extractChequePaymentAnswer, extractChequePaymentAnswerFromEvidence, selectContextChunks } from "../../src/services/chat.js";

test("chat cache identity excludes the query but scopes workspace, prompt, provider, and model", () => {
  const base = { workspaceSlug: "workspace-a", workspacePrompt: "stable workspace rules", provider: "openai" as const, model: "gpt-4.1-mini" };
  const first = createContextCacheIdentity(base);
  assert.equal(first, createContextCacheIdentity(base));
  assert.notEqual(first, createContextCacheIdentity({ ...base, workspaceSlug: "workspace-b" }));
  assert.notEqual(first, createContextCacheIdentity({ ...base, workspacePrompt: "changed rules" }));
  assert.notEqual(first, createContextCacheIdentity({ ...base, provider: "anthropic", model: "claude-test" }));
  assert.notEqual(first, createContextCacheIdentity({ ...base, model: "gpt-4.1" }));
});

test("stable chat rules are reusable while questions and evidence remain dynamic", () => {
  const stable = buildStableChatPrefix("workspace policy");
  const dynamicOne = buildDynamicChatPrompt("first question", [{
    documentId: "doc-1", chunkId: "chunk-1", documentName: "private.pdf", title: "First",
    chunkIndex: 0, heading: "Evidence", content: "first evidence", sourceType: "SEMANTIC", score: 1
  }]);
  const dynamicTwo = buildDynamicChatPrompt("second question", [{
    documentId: "doc-2", chunkId: "chunk-2", documentName: "other.pdf", title: "Second",
    chunkIndex: 0, heading: "Evidence", content: "second evidence", sourceType: "SEMANTIC", score: 1
  }]);
  assert.doesNotMatch(stable, /first question|first evidence|private\.pdf/);
  assert.notEqual(dynamicOne, dynamicTwo);
  const flattened = flattenGenerationInput({ stablePrefix: stable, dynamicPrompt: dynamicOne });
  assert.ok(flattened.indexOf(stable) < flattened.indexOf(dynamicOne));
});

test("context keeps the highest-ranked evidence instead of an unbounded result tail", () => {
  const chunks = Array.from({ length: 8 }, (_, index) => ({
    documentId: `doc-${index}`, chunkId: `chunk-${index}`, documentName: `doc-${index}`, title: `Document ${index}`,
    chunkIndex: index, heading: null, content: "evidence", sourceType: "SEMANTIC" as const, score: 1
  }));
  assert.deepEqual(selectContextChunks(chunks, 1_000).map((chunk) => chunk.chunkId), ["chunk-0", "chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"]);
});

test("a two-cheque receipt is rendered from its evidence without model paraphrasing", () => {
  const evidence = "27.12.1988 tarih ve 412069 No.lu Aydın Bükülmez imzalı 1.683.400.- TL aynı bankanın 29.12.1988 tarih ve 57892 No.lu vekil Av. E. Ruhi Öztürk imzalı 2.805.653.- TL liralık iki adet çek";
  const answer = extractChequePaymentAnswer("Çeklerin tarih ve tutarını belirt.", evidence);
  assert.match(answer ?? "", /412069/);
  assert.match(answer ?? "", /2\.805\.653 TL/);
  assert.match(answer ?? "", /4\.489\.053 TL/);
});

test("cheque receipt includes every detected cheque in the total", () => {
  const evidence = "01.01.2020 tarih ve 1 No.lu Ali Veli imzalı 100.- TL 02.01.2020 tarih ve 2 No.lu Ayşe Demir imzalı 200.- TL 03.01.2020 tarih ve 3 No.lu Mehmet Kaya imzalı 300.- TL";
  const answer = extractChequePaymentAnswer("Çeklerin toplamı nedir?", evidence);
  assert.match(answer ?? "", /3 çekle/);
  assert.match(answer ?? "", /600 TL/);
});

test("cheque receipt selects the evidence matching every property identifier", () => {
  const unrelated = "14.10.1977 tarih ve 10 No.lu Ali Veli imzalı 250.000.- TL 07.11.1977 tarih ve 11 No.lu Ayşe Demir imzalı 500.000.- TL";
  const matching = "Kilyos 1 pafta, 41 parsel ödemesi 27.12.1988 tarih ve 412069 No.lu Aydın Bükülmez imzalı 1.683.400.- TL 29.12.1988 tarih ve 57892 No.lu Av. E. Ruhi Öztürk imzalı 2.805.653.- TL";
  const answer = extractChequePaymentAnswerFromEvidence("Kilyos 1 pafta 41 parsel çeklerini ver.", [unrelated, matching]);
  assert.match(answer ?? "", /412069/);
  assert.match(answer ?? "", /4\.489\.053 TL/);
  assert.match(answer ?? "", /\[2\]/);
});

test("evidence snippet centers the source card on a query match", () => {
  const content = `${"başlangıç ".repeat(80)}parsel 192 tapu kaydı ${"son ".repeat(80)}`;
  const snippet = createEvidenceSnippet(content, "192 parsel nedir?");
  assert.match(snippet, /parsel 192 tapu kaydı/);
  assert.ok(snippet.length <= 502);
});
