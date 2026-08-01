import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDatabaseClient } from "@knowledgeos/database";
import { loadConfig } from "../../src/config/env.js";
import { getLexicalSemanticContext, searchSemanticDocuments } from "../../src/services/semantic-search.js";
import { searchEntityDocuments } from "../../src/services/search.js";
import { registerWorkspaceMetadataFields, getWorkspaceFields, replaceDocumentFieldValues } from "../../src/services/workspace-fields.js";
import { replaceDocumentMetadataEntities } from "../../src/services/entities.js";
import { resolveAnalysisDocumentIds, type QueryAnalysis } from "../../src/services/query-analyzer.js";
import { buildExecutionPlan, planQueryExecution } from "../../src/services/execution-planner.js";
import { executeDirectPlan } from "../../src/services/execution-engine.js";
import { saveChatExchange } from "../../src/services/chat-history.js";
import { listExecutionTelemetry } from "../../src/services/execution-telemetry.js";

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
      values (${workspace.id}, 'tapu-192.md', 'Tapu 192', '/test/tapu-192.md', 'Ayşe Demir 192 parsel sahibidir. Hüseyin Hüsnü Subaşı 12.6.1964 tarihinde İstanbul''da vefat etti.', 'ayse demir 192 parsel sahibidir huseyin husnu subasi 12 6 1964 tarihinde istanbul da vefat etti', 'tapu', '2024-05-03', 'INDEXED', ${`hash-${suffix}`}) returning id`;
    await client.queryClient`
      insert into document_chunks (document_id, chunk_index, content, normalized_content, content_hash, token_count)
      values (${document.id}, 0, 'Ayşe Demir 192 parsel sahibidir. Hüseyin Hüsnü Subaşı 12.6.1964 tarihinde İstanbul''da vefat etti.', 'ayse demir 192 parsel sahibidir huseyin husnu subasi 12 6 1964 tarihinde istanbul da vefat etti', encode(digest(convert_to('Ayşe Demir 192 parsel sahibidir. Hüseyin Hüsnü Subaşı 12.6.1964 tarihinde İstanbul''da vefat etti.', 'UTF8'), 'sha256'), 'hex'), 18)`;
    const [field] = await client.queryClient<{ id: string }[]>`
      insert into workspace_fields (workspace_id, key, label, value_type)
      values (${workspace.id}, 'people', 'People', 'TEXT_ARRAY') returning id`;
    const [entity] = await client.queryClient<{ id: string }[]>`
      insert into entities (field_id, canonical_value, normalized_value)
      values (${field.id}, 'Ayşe Demir', 'ayse demir') returning id`;
    await client.queryClient`insert into entity_aliases (entity_id, alias, normalized_alias, confidence, source) values (${entity.id}, 'Ayşe Demir', 'ayse demir', 1, 'REGEX')`;
    await client.queryClient`insert into document_entities (document_id, entity_id, mention_count, evidence_snippet, confidence) values (${document.id}, ${entity.id}, 1, 'Ayşe Demir 192 parsel sahibidir.', 1)`;

    const config = { ...loadConfig(), databaseUrl: url };
    const lexical = await getLexicalSemanticContext(config, slug, "192 parsel", 10, { year: "2024", documentType: "tapu" });
    const dateLexical = await getLexicalSemanticContext(config, slug, "What happened on 12 June 1964?", 10);
    const entityResult = await searchEntityDocuments(config, { workspaceSlug: slug, query: "Ayşe Demir hangi belgelerde geçiyor?", filters: { year: "2024" } });
    assert.equal(lexical[0]?.documentName, "tapu-192");
    assert.equal(lexical[0]?.sourceType, "LEXICAL");
    assert.equal(dateLexical[0]?.documentId, document.id);
    assert.match(dateLexical[0]?.content ?? "", /12\.6\.1964/);
    assert.equal(entityResult.matchedEntity?.canonicalValue, "Ayşe Demir");
    assert.equal(entityResult.retrievedDocuments[0]?.documentId, document.id);
    const emptyEntityScope = await searchEntityDocuments(config, { workspaceSlug: slug, query: "Ayşe Demir", filters: { allowedDocumentIds: [] } });
    const emptyLexicalScope = await getLexicalSemanticContext(config, slug, "12.6.1964", 10, { allowedDocumentIds: [] });
    const emptySemanticScope = await searchSemanticDocuments(config, { workspaceSlug: slug, query: "12.6.1964", filters: { allowedDocumentIds: [] } });
    assert.equal(emptyEntityScope.retrievedDocuments.length, 0);
    assert.equal(emptyLexicalScope.length, 0);
    assert.equal(emptySemanticScope.results.length, 0);
    const [ftsIndex] = await client.queryClient<{ exists: boolean }[]>`
      select exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'document_chunks_simple_fts_idx') as exists`;
    assert.equal(ftsIndex.exists, true);
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
  }
});

test("dynamic metadata fields drive entity links and document filters", async (t) => {
  const url = testUrl(t);
  if (!url) return;
  const client = createDatabaseClient(url);
  const suffix = Date.now().toString(36);
  const slug = `dynamic-fixture-${suffix}`;
  try {
    const [workspace] = await client.queryClient<{ id: string }[]>`
      insert into workspaces (slug, name, storage_path)
      values (${slug}, 'Dynamic Fixture', ${`/test/${slug}`}) returning id`;
    const metadata = { contractors: ["Örnek İnşaat A.Ş."], date: "2024-05-03", summary: "Long-form summary" };
    const [document] = await client.queryClient<{ id: string }[]>`
      insert into documents (workspace_id, filename, title, markdown_path, content, normalized_content, metadata, status, hash)
      values (${workspace.id}, 'contract.md', 'Contract', '/test/contract.md', 'Örnek İnşaat A.Ş. ile Örnek İnşaat A.Ş. sözleşmesi.', 'ornek insaat a s ile ornek insaat a s sozlesmesi', '{}'::jsonb, 'INDEXED', ${`dynamic-${suffix}`})
      returning id`;
    await client.queryClient`
      insert into document_chunks (document_id, chunk_index, content, normalized_content, content_hash, token_count)
      values (${document.id}, 0, 'Örnek İnşaat A.Ş. ile Örnek İnşaat A.Ş. sözleşmesi.', 'ornek insaat a s ile ornek insaat a s sozlesmesi', encode(digest(convert_to('Örnek İnşaat A.Ş. ile Örnek İnşaat A.Ş. sözleşmesi.', 'UTF8'), 'sha256'), 'hex'), 9)`;
    const config = { ...loadConfig(), databaseUrl: url };
    await replaceDocumentFieldValues(config, slug, document.id, metadata);
    await replaceDocumentMetadataEntities(config, slug, document.id, metadata);
    const fields = await getWorkspaceFields(config, slug);
    const contractors = fields.find((field) => field.key === "contractors");
    const summary = fields.find((field) => field.key === "summary");
    assert.equal(contractors?.entityEnabled, true);
    assert.equal(contractors?.entityCount, 1);
    assert.equal(summary?.entityEnabled, false);
    const [indexed] = await client.queryClient<Array<{ document_mentions: number; max_chunk_mentions: number; chunk_mentions: number; field_values: number; hash_length: number }>>`
      select
        (select mention_count from document_entities where document_id = ${document.id} limit 1)::int as document_mentions,
        (select max_chunk_mentions from document_entities where document_id = ${document.id} limit 1)::int as max_chunk_mentions,
        (select mention_count from chunk_entities ce join document_chunks dc on dc.id = ce.chunk_id where dc.document_id = ${document.id} limit 1)::int as chunk_mentions,
        (select count(*) from document_field_values where document_id = ${document.id})::int as field_values,
        (select length(content_hash) from document_chunks where document_id = ${document.id} limit 1)::int as hash_length`;
    assert.equal(indexed.document_mentions, 2);
    assert.equal(indexed.max_chunk_mentions, 2);
    assert.equal(indexed.chunk_mentions, 2);
    assert.equal(indexed.field_values, 2);
    assert.equal(indexed.hash_length, 64);
    const entityResult = await searchEntityDocuments(config, { workspaceSlug: slug, query: "Örnek İnşaat A.Ş. hangi belgelerde geçiyor?" });
    assert.equal(entityResult.retrievedDocuments[0]?.documentId, document.id);
    const analysis: QueryAnalysis = {
      queryType: "ENTITY_SEARCH",
      intent: "FIND",
      originalQuery: "Örnek İnşaat",
      semanticQuery: "Örnek İnşaat",
      filters: [{
        fieldId: contractors!.id,
        fieldKey: contractors!.key,
        operator: "CONTAINS",
        value: "Örnek İnşaat",
        source: "CATALOG",
        confidence: 1,
        locked: true
      }],
      matchedEntityIds: [entityResult.matchedEntity!.id],
      unresolvedTerms: [],
      fallbackUsed: false,
      relaxedFilters: []
    };
    assert.deepEqual(await resolveAnalysisDocumentIds(config, slug, analysis), [document.id]);
    const countAnalysis = { ...analysis, intent: "COUNT" as const, originalQuery: "Örnek İnşaat kaç belgede geçiyor?" };
    const direct = await executeDirectPlan(config, slug, countAnalysis, buildExecutionPlan(countAnalysis));
    assert.equal(direct?.count, 1);
    assert.equal(direct?.answer, "Eşleşen indekslenmiş belge sayısı: 1.");
    const planned = await planQueryExecution(config, slug, countAnalysis);
    assert.equal(planned.capabilities.directAggregation, true);
    assert.equal(planned.estimates.totalDocuments, 1);
    assert.equal(planned.estimates.filteredDocuments, 1);
    const groupedAnalysis = {
      ...analysis,
      intent: "GROUP_BY" as const,
      aggregationField: { fieldId: contractors!.id, fieldKey: contractors!.key }
    };
    const grouped = await executeDirectPlan(config, slug, groupedAnalysis, buildExecutionPlan(groupedAnalysis));
    assert.deepEqual(grouped?.rows, [{ value: "Örnek İnşaat A.Ş.", count: 1 }]);
    const dateField = fields.find((field) => field.key === "date")!;
    const timelineAnalysis = {
      ...analysis,
      intent: "TIMELINE" as const,
      aggregationField: { fieldId: dateField.id, fieldKey: dateField.key }
    };
    const timeline = await executeDirectPlan(config, slug, timelineAnalysis, buildExecutionPlan(timelineAnalysis));
    assert.equal(timeline?.rows[0]?.date, "2024-05-03");
    await saveChatExchange(config, {
      workspaceSlug: slug,
      message: "SORGUKIMLIGI Örnek İnşaat kaç belgede geçiyor?",
      response: {
        queryType: countAnalysis.queryType,
        analysis: countAnalysis,
        executionPlan: planned,
        executionTelemetry: {
          planningMs: 1,
          executionMs: direct?.executionMs ?? 0,
          estimatedRows: planned.estimates.expectedRows,
          actualRows: direct?.count ?? 0,
          nodeMetrics: []
        },
        answer: direct?.answer ?? "",
        matchedEntity: null,
        matchedAliases: [],
        sources: []
      }
    });
    const [telemetry] = await client.queryClient<Array<{ count: number; raw_query_stored: boolean }>>`
      select count(*)::int as count, bool_or(plan_json::text like '%SORGUKIMLIGI%') as raw_query_stored
      from query_executions where workspace_id = ${workspace.id}`;
    assert.equal(telemetry.count, 1);
    assert.equal(telemetry.raw_query_stored, false);
    const telemetryApi = await listExecutionTelemetry(config, slug, 10);
    assert.equal(telemetryApi[0]?.intent, "COUNT");
    assert.equal(telemetryApi[0]?.actualRows, 1);
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
  }
});
