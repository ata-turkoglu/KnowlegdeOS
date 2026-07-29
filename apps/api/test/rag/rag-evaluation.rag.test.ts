import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseClient } from "@knowledgeos/database";
import { classifyQuery } from "@knowledgeos/search";
import { loadConfig } from "../../src/config/env.js";
import { reciprocalRankFusion, validateCitations } from "../../src/services/rag-core.js";
import { getLexicalSemanticContext } from "../../src/services/semantic-search.js";

test("versioned database-backed RAG fixture meets retrieval and safety thresholds", async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { t.skip("TEST_DATABASE_URL is absent; no database was touched."); return; }
  if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) throw new Error("RAG tests refuse databases whose name does not end in _test.");
  const client = createDatabaseClient(url);
  const suffix = Date.now().toString(36);
  const slug = `rag-eval-${suffix}`;
  try {
    const [workspace] = await client.queryClient<{ id: string }[]>`insert into workspaces (slug, name, storage_path) values (${slug}, 'RAG Evaluation v1', ${`/test/${slug}`}) returning id`;
    const documents = [
      { filename: "tapu-192.md", title: "Tapu 192", content: "Ayşe Demir 192 parsel üzerinde hak sahibidir.", normalized: "ayse demir 192 parsel uzerinde hak sahibidir", type: "tapu" },
      { filename: "mahkeme-44.md", title: "Mahkeme 44", content: "44 numaralı karar Mehmet Kaya hakkındadır.", normalized: "44 numarali karar mehmet kaya hakkindadir", type: "mahkeme" }
    ];
    for (const item of documents) {
      const [document] = await client.queryClient<{ id: string }[]>`
        insert into documents (workspace_id, filename, title, markdown_path, content, normalized_content, document_type, status, hash)
        values (${workspace.id}, ${item.filename}, ${item.title}, ${`/test/${item.filename}`}, ${item.content}, ${item.normalized}, ${item.type}, 'INDEXED', ${`${suffix}-${item.filename}`}) returning id`;
      await client.queryClient`insert into document_chunks (document_id, chunk_index, content, normalized_content, content_hash, token_count) values (${document.id}, 0, ${item.content}, ${item.normalized}, encode(digest(convert_to(${item.content}, 'UTF8'), 'sha256'), 'hex'), 10)`;
    }

    const config = { ...loadConfig(), databaseUrl: url };
    const cases = [
      { query: "192 parsel hak", expected: "tapu-192", type: "SEMANTIC_SEARCH" },
      { query: "44 karar Mehmet", expected: "mahkeme-44", type: "SEMANTIC_SEARCH" }
    ] as const;
    let hits = 0;
    for (const item of cases) {
      const lexical = await getLexicalSemanticContext(config, slug, item.query, 5);
      const fused = reciprocalRankFusion([lexical.map((chunk) => ({
        documentId: chunk.documentId, chunkId: chunk.chunkId, chunkIndex: chunk.chunkIndex, documentName: chunk.documentName,
        title: chunk.title, heading: chunk.heading, content: chunk.content, evidenceSnippet: chunk.content, sourceType: "LEXICAL" as const, score: chunk.score ?? 0
      }))]);
      if (fused[0]?.documentName === item.expected) hits++;
      assert.equal(classifyQuery(item.query), item.type);
    }
    const hitRateAtOne = hits / cases.length;
    assert.ok(hitRateAtOne >= .9, `HitRate@1 was ${hitRateAtOne}`);
    assert.equal(validateCitations("Belgedeki doğrulanmış bilgi [1]", 1, true).valid, true);
    assert.equal(validateCitations("Kaynak bulunamadı", 0, false).valid, true);
    assert.equal(validateCitations("Dayanaksız yanıt", 0, true).valid, false);
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
  }
});
