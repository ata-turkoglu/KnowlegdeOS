import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDatabaseClient } from "@knowledgeos/database";
import { loadConfig } from "../../src/config/env.js";
import { getLexicalSemanticContext } from "../../src/services/semantic-search.js";
import { searchEntityDocuments } from "../../src/services/search.js";

function testUrl(t: TestContext) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { t.skip("TEST_DATABASE_URL is absent; no database was touched."); return null; }
  if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) throw new Error("Integration tests refuse databases whose name does not end in _test.");
  return url;
}

test("PostgreSQL lexical and entity retrieval return seeded evidence", async (t) => {
  const url = testUrl(t);
  if (!url) return;
  const client = createDatabaseClient(url);
  const suffix = Date.now().toString(36);
  const slug = `rag-fixture-${suffix}`;
  try {
    const [workspace] = await client.queryClient<{ id: string }[]>`insert into workspaces (slug, name, storage_path) values (${slug}, 'RAG Fixture', ${`/test/${slug}`}) returning id`;
    const [document] = await client.queryClient<{ id: string }[]>`
      insert into documents (workspace_id, filename, title, markdown_path, content, normalized_content, document_type, document_date, status, hash)
      values (${workspace.id}, 'tapu-192.md', 'Tapu 192', '/test/tapu-192.md', 'Ayşe Demir 192 parsel sahibidir.', 'ayse demir 192 parsel sahibidir', 'tapu', '2024-05-03', 'INDEXED', ${`hash-${suffix}`}) returning id`;
    await client.queryClient`
      insert into document_chunks (document_id, chunk_index, content, normalized_content, token_count)
      values (${document.id}, 0, 'Ayşe Demir 192 parsel sahibidir.', 'ayse demir 192 parsel sahibidir', 8)`;
    const [entity] = await client.queryClient<{ id: string }[]>`
      insert into entities (workspace_id, type, canonical_value, normalized_value)
      values (${workspace.id}, 'PERSON', 'Ayşe Demir', 'ayse demir') returning id`;
    await client.queryClient`insert into entity_aliases (entity_id, alias, normalized_alias, confidence, source) values (${entity.id}, 'Ayşe Demir', 'ayse demir', 1, 'REGEX')`;
    await client.queryClient`insert into document_entities (document_id, entity_id, occurrence_count, evidence_snippet, confidence) values (${document.id}, ${entity.id}, 1, 'Ayşe Demir 192 parsel sahibidir.', 1)`;

    const config = { ...loadConfig(), databaseUrl: url };
    const lexical = await getLexicalSemanticContext(config, slug, "192 parsel", 10, { year: "2024", documentType: "tapu" });
    const entityResult = await searchEntityDocuments(config, { workspaceSlug: slug, query: "Ayşe Demir hangi belgelerde geçiyor?", filters: { year: "2024" } });
    assert.equal(lexical[0]?.documentName, "tapu-192");
    assert.equal(lexical[0]?.sourceType, "LEXICAL");
    assert.equal(entityResult.matchedEntity?.canonicalValue, "Ayşe Demir");
    assert.equal(entityResult.retrievedDocuments[0]?.documentId, document.id);
    const [ftsIndex] = await client.queryClient<{ exists: boolean }[]>`
      select exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'document_chunks_simple_fts_idx') as exists`;
    assert.equal(ftsIndex.exists, true);
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
  }
});
