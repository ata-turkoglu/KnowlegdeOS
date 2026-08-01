import assert from "node:assert/strict";
import test from "node:test";
import {
  inferMetadataValueType,
  canonicalizeDateValue,
  mergeMetadataValue,
  normalizeMetadataKey,
  shouldIndexMetadataValue,
  widenMetadataValueType
} from "../../src/services/workspace-fields.js";
import { cosineSimilarity } from "../../src/services/workspace-fields.js";
import { entityMentionCompatible, tokenSimilarity } from "../../src/services/entities.js";
import { deterministicAnalysis, relaxQueryAnalysis, selectAnalyzerContext } from "../../src/services/query-analyzer.js";
import { buildExecutionPlan, validateExecutionPlan } from "../../src/services/execution-planner.js";

test("dynamic metadata keys are normalized without a fixed whitelist", () => {
  assert.equal(normalizeMetadataKey("  Contractor Names  "), "contractor_names");
  assert.equal(normalizeMetadataKey("Yapı-Türü"), "yapi_turu");
});

test("metadata field types widen without dropping values", () => {
  assert.equal(inferMetadataValueType("date", "2024-05-10"), "DATE");
  assert.equal(inferMetadataValueType("contractors", ["A", "B"]), "TEXT_ARRAY");
  assert.equal(widenMetadataValueType("DATE", "TEXT"), "TEXT");
  assert.equal(widenMetadataValueType("TEXT", "TEXT_ARRAY"), "TEXT_ARRAY");
  assert.deepEqual(mergeMetadataValue("A", ["A", "B"]), ["A", "B"]);
});

test("localized metadata dates canonicalize to sortable ISO values", () => {
  assert.equal(canonicalizeDateValue("18.01.1985"), "1985-01-18");
  assert.equal(canonicalizeDateValue("31/02/1985"), null);
  assert.equal(canonicalizeDateValue("0974-10-24"), "0974-10-24");
  assert.equal(canonicalizeDateValue("1973-05"), null);
  assert.equal(canonicalizeDateValue("21.08.1927"), "1927-08-21");
});

test("long operational values stay out of the entity index", () => {
  assert.equal(shouldIndexMetadataValue("summary", "short summary"), false);
  assert.equal(shouldIndexMetadataValue("contractors", "Example Construction"), true);
  assert.equal(shouldIndexMetadataValue("custom", "x".repeat(257)), false);
});

test("small-model guards accept grounded entity variants and reject unrelated mentions", () => {
  assert.ok(tokenSimilarity("cobanoglu", "cobanoglu") > .99);
  assert.ok(tokenSimilarity("cobanoglu", "cobanogluu") > .8);
  assert.equal(entityMentionCompatible("A. Çobanoğlu", ["Ali Çobanoğlu"]), true);
  assert.equal(entityMentionCompatible("Mehmet Yılmaz", ["Ali Çobanoğlu"]), false);
});

test("field matcher cosine scoring rejects incompatible vector dimensions", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
});

test("deterministic query fallback locks exact dynamic metadata values", () => {
  const fields = [{
    id: "field-date",
    workspaceId: "workspace",
    key: "date",
    label: "Date",
    valueType: "DATE" as const,
    filterable: true,
    entityEnabled: false,
    searchable: true,
    aliases: []
  }, {
    id: "field-people",
    workspaceId: "workspace",
    key: "people",
    label: "People",
    valueType: "TEXT_ARRAY" as const,
    filterable: true,
    entityEnabled: true,
    searchable: true,
    aliases: []
  }];
  const result = deterministicAnalysis("2024 tarihli Mehmet Yılmaz belgeleri", fields, [{
    id: "entity-mehmet",
    fieldId: "field-people",
    fieldKey: "people",
    value: "Mehmet Yılmaz",
    normalizedValue: "mehmet yilmaz"
  }]);
  assert.equal(result.filters.length, 2);
  assert.ok(result.filters.every((filter) => filter.locked));
  assert.deepEqual(result.matchedEntityIds, ["entity-mehmet"]);
});

test("filter relaxation removes only low-confidence LLM filters", () => {
  const base = deterministicAnalysis("belgeler", [], []);
  const locked = { fieldId: "a", fieldKey: "date", operator: "EQ" as const, value: "2024", source: "RULE" as const, confidence: 1, locked: true };
  const weak = { fieldId: "b", fieldKey: "people", operator: "EQ" as const, value: "Ali", source: "LLM" as const, confidence: .6, locked: false };
  const strong = { ...weak, fieldId: "c", fieldKey: "places", confidence: .9 };
  const relaxed = relaxQueryAnalysis({ ...base, filters: [locked, weak, strong] });
  assert.deepEqual(relaxed.filters, [locked, strong]);
  assert.deepEqual(relaxed.relaxedFilters, [weak]);
});

test("execution planner turns document counts into a deterministic plan", () => {
  const analysis = deterministicAnalysis("Ali Çobanoğlu kaç belgede geçiyor?", [], []);
  const plan = buildExecutionPlan(analysis);
  assert.equal(analysis.intent, "COUNT");
  assert.equal(plan.strategy, "DETERMINISTIC");
  assert.equal(plan.requiresLlmAnswer, false);
  assert.deepEqual(plan.nodes.map((node) => node.op), ["FILTER", "ENTITY_LOOKUP", "COUNT", "ANSWER"]);
});

test("execution planner keeps summaries on the generative retrieval pipeline", () => {
  const analysis = deterministicAnalysis("Ali Çobanoğlu ile ilgili belgeleri özetle", [], []);
  const plan = buildExecutionPlan(analysis);
  assert.equal(analysis.intent, "SUMMARIZE");
  assert.equal(plan.requiresLlmAnswer, true);
  assert.ok(plan.nodes.some((node) => node.op === "SEMANTIC_SEARCH"));
  assert.equal(plan.nodes.at(-1)?.op, "ANSWER");
});

test("execution plan validation rejects unsafe limits", () => {
  const plan = buildExecutionPlan(deterministicAnalysis("belgeleri bul", [], []));
  const lexical = plan.nodes.find((node) => node.op === "LEXICAL_SEARCH");
  if (!lexical || lexical.op !== "LEXICAL_SEARCH") throw new Error("Expected lexical step.");
  lexical.limit = 1_000;
  assert.throws(() => validateExecutionPlan(plan), /limit is invalid/);
});

test("execution planner represents retrievers as parallel DAG branches", () => {
  const analysis = deterministicAnalysis("arşivdeki sözleşmeleri özetle", [], []);
  const plan = buildExecutionPlan(analysis, 20, { totalDocuments: 100, filteredDocuments: 40, expectedRows: 20, semanticSearch: true });
  const retrieval = plan.nodes.filter((node) => node.parallelGroup === "RETRIEVAL");
  assert.ok(retrieval.length >= 2);
  const fusion = plan.nodes.find((node) => node.op === "RRF");
  assert.deepEqual(new Set(fusion?.dependsOn), new Set(retrieval.map((node) => node.id)));
});

test("planner selects direct capabilities for timeline and facets", () => {
  const timeline = buildExecutionPlan(deterministicAnalysis("en eski belge hangisi", [], []));
  assert.equal(timeline.requiresLlmAnswer, false);
  assert.ok(timeline.nodes.some((node) => node.op === "SORT"));
  const field = {
    id: "field-type",
    workspaceId: "workspace",
    key: "document_type",
    label: "Document Type",
    valueType: "TEXT" as const,
    filterable: true,
    entityEnabled: true,
    searchable: true,
    aliases: ["belge_turu"]
  };
  const facet = buildExecutionPlan(deterministicAnalysis("belge türüne göre dağılım", [field], []));
  assert.equal(facet.intent, "FACET");
  assert.equal(facet.nodes.find((node) => node.op === "FACET")?.fieldId, field.id);
});

test("analyzer context selector keeps candidate and date fields while bounding the prompt", () => {
  const fields = Array.from({ length: 30 }, (_, index) => ({
    id: `field-${index}`,
    workspaceId: "workspace",
    key: index === 25 ? "date" : `field_${index}`,
    label: index === 25 ? "Date" : `Field ${index}`,
    valueType: index === 25 ? "DATE" as const : "TEXT" as const,
    filterable: true,
    entityEnabled: index === 4,
    searchable: true,
    aliases: []
  }));
  const selected = selectAnalyzerContext("1985 Ali belgeleri", fields, [{
    id: "entity",
    fieldId: "field-4",
    fieldKey: "field_4",
    value: "Ali",
    normalizedValue: "ali"
  }], [], 20);
  assert.ok(selected.some((field) => field.id === "field-4"));
  assert.ok(selected.some((field) => field.key === "date"));
  assert.ok(selected.length <= 20);
});
