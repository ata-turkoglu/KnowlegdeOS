import { eq, sql } from "drizzle-orm";
import { createDatabaseClient, documentFieldValues, entities, entityAliases, workspaceFields, workspaces } from "@knowledgeos/database";
import { normalizeForSearch } from "@knowledgeos/ingestion";
import { classifyQuery } from "@knowledgeos/search";
import type { QueryType } from "@knowledgeos/shared";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { getLlmProvider } from "./ai-providers.js";
import { extractLabeledNumericAnchors } from "./rag-core.js";
import { getWorkspaceFieldDefinitions, type WorkspaceFieldDefinition } from "./workspace-fields.js";

export type QueryFilterOperator = "EQ" | "CONTAINS" | "IN" | "GTE" | "LTE" | "BETWEEN";
export type QueryIntent = "FIND" | "SUMMARIZE" | "COUNT" | "COMPARE" | "TIMELINE" | "EXISTS" | "DISTINCT" | "GROUP_BY" | "FACET";
export type QueryFilter = {
  fieldId: string;
  fieldKey: string;
  operator: QueryFilterOperator;
  value: string | string[];
  source: "RULE" | "CATALOG" | "LLM";
  confidence: number;
  locked: boolean;
};
export type QueryAnalysis = {
  queryType: QueryType;
  intent: QueryIntent;
  originalQuery: string;
  semanticQuery: string;
  filters: QueryFilter[];
  matchedEntityIds: string[];
  unresolvedTerms: string[];
  fallbackUsed: boolean;
  relaxedFilters: QueryFilter[];
  aggregationField?: { fieldId: string; fieldKey: string };
  analyzerContext?: { fieldCount: number; totalFieldCount: number; entityCandidateCount: number; metadataValueCandidateCount: number };
};

type EntityCandidate = { id: string; fieldId: string; fieldKey: string; value: string; normalizedValue: string };
type MetadataValueCandidate = { fieldId: string; fieldKey: string; value: string; normalizedValue: string };
type RawAnalysis = {
  queryType?: string;
  intent?: string;
  semanticQuery?: string;
  filters?: Array<{ fieldKey?: string; operator?: string; value?: string | string[]; confidence?: number }>;
  matchedEntityIds?: string[];
  unresolvedTerms?: string[];
  aggregationFieldKey?: string;
};

const operators = new Set<QueryFilterOperator>(["EQ", "CONTAINS", "IN", "GTE", "LTE", "BETWEEN"]);
const intents = new Set<QueryIntent>(["FIND", "SUMMARIZE", "COUNT", "COMPARE", "TIMELINE", "EXISTS", "DISTINCT", "GROUP_BY", "FACET"]);

export async function analyzeQuery(
  config: ApiConfig,
  input: { workspaceSlug: string; query: string; signal?: AbortSignal }
): Promise<QueryAnalysis> {
  const [fields, candidates, metadataCandidates] = await Promise.all([
    getWorkspaceFieldDefinitions(config, input.workspaceSlug),
    findEntityCandidates(config, input.workspaceSlug, input.query, 50),
    findMetadataValueCandidates(config, input.workspaceSlug, input.query, 20)
  ]);
  const selectedFields = selectAnalyzerContext(input.query, fields, candidates, metadataCandidates, 20);
  const selectedIds = new Set(selectedFields.map((field) => field.id));
  const selectedCandidates = candidates.filter((candidate) => selectedIds.has(candidate.fieldId));
  const selectedMetadataCandidates = metadataCandidates.filter((candidate) => selectedIds.has(candidate.fieldId));
  const deterministic = {
    ...deterministicAnalysis(input.query, fields, candidates, metadataCandidates),
    analyzerContext: {
      fieldCount: selectedFields.length,
      totalFieldCount: fields.length,
      entityCandidateCount: selectedCandidates.length,
      metadataValueCandidateCount: selectedMetadataCandidates.length
    }
  };
  try {
    const raw = await getLlmProvider(config, "answer").generateJsonObject<RawAnalysis>(
      buildQueryAnalysisPrompt(input.query, selectedFields, selectedCandidates, selectedMetadataCandidates, deterministic),
      input.signal
    );
    return validateAnalysis(raw, input.query, selectedFields, selectedCandidates, deterministic);
  } catch {
    return { ...deterministic, fallbackUsed: true };
  }
}

export function deterministicAnalysis(
  query: string,
  fields: WorkspaceFieldDefinition[],
  candidates: EntityCandidate[] = [],
  metadataCandidates: MetadataValueCandidate[] = []
): QueryAnalysis {
  const filters: QueryFilter[] = [];
  const normalized = normalizeForSearch(query);
  const date = query.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const year = date?.slice(0, 4) ?? query.match(/\b(?:19|20)\d{2}\b/)?.[0];
  const dateField = fields.find((field) => field.key === "date");
  if (date && dateField) filters.push(filterOf(dateField, "EQ", date, "RULE", 1, true));
  else if (year && dateField) filters.push(filterOf(dateField, "CONTAINS", year, "RULE", 1, true));
  const documentType = normalized.match(/\b(tapu|vekaletname|mahkeme|dilekce)\b/u)?.[1];
  const typeField = fields.find((field) => field.key === "document_type");
  if (documentType && typeField) filters.push(filterOf(typeField, "CONTAINS", documentType, "RULE", .98, true));
  for (const anchor of extractLabeledNumericAnchors(query)) {
    const field = fields.find((item) => item.key === `${anchor.label}s` || item.key === anchor.label || item.aliases.includes(anchor.label));
    if (field) filters.push(filterOf(field, "CONTAINS", anchor.value, "RULE", 1, true));
  }
  const exactCandidates = candidates.filter((candidate) => normalized.includes(candidate.normalizedValue));
  for (const candidate of exactCandidates) {
    const field = fields.find((item) => item.id === candidate.fieldId);
    if (field) filters.push(filterOf(field, "EQ", candidate.value, "CATALOG", .99, true));
  }
  for (const candidate of metadataCandidates.filter((item) => normalized.includes(item.normalizedValue))) {
    const field = fields.find((item) => item.id === candidate.fieldId);
    if (field) filters.push(filterOf(field, "EQ", candidate.value, "CATALOG", .97, true));
  }
  const aggregationField = selectAggregationField(query, fields);
  return {
    queryType: classifyQuery(query),
    intent: inferQueryIntent(query),
    originalQuery: query,
    semanticQuery: query,
    filters: dedupeFilters(filters),
    matchedEntityIds: exactCandidates.map((candidate) => candidate.id),
    unresolvedTerms: [],
    fallbackUsed: false,
    relaxedFilters: [],
    aggregationField
  };
}

function validateAnalysis(
  raw: RawAnalysis,
  query: string,
  fields: WorkspaceFieldDefinition[],
  candidates: EntityCandidate[],
  deterministic: QueryAnalysis
): QueryAnalysis {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const llmFilters: QueryFilter[] = [];
  for (const item of raw.filters ?? []) {
    const field = item.fieldKey ? fieldByKey.get(item.fieldKey) : undefined;
    const operator = item.operator as QueryFilterOperator;
    if (!field?.filterable || !operators.has(operator) || typeof item.value !== "string" && !Array.isArray(item.value)) continue;
    llmFilters.push(filterOf(field, operator, item.value, "LLM", clampConfidence(item.confidence), false));
  }
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  const matchedEntityIds = [...new Set([
    ...deterministic.matchedEntityIds,
    ...(raw.matchedEntityIds ?? []).filter((id) => allowedIds.has(id))
  ])];
  const queryType = ["ENTITY_SEARCH", "SEMANTIC_SEARCH", "HYBRID_SEARCH"].includes(raw.queryType ?? "")
    ? raw.queryType as QueryType
    : deterministic.queryType;
  return {
    queryType,
    intent: deterministic.intent !== "FIND" || !intents.has(raw.intent as QueryIntent)
      ? deterministic.intent
      : raw.intent as QueryIntent,
    originalQuery: query,
    semanticQuery: typeof raw.semanticQuery === "string" && raw.semanticQuery.trim() ? raw.semanticQuery.trim() : query,
    filters: dedupeFilters([...deterministic.filters, ...llmFilters]),
    matchedEntityIds,
    unresolvedTerms: (raw.unresolvedTerms ?? []).filter((item): item is string => typeof item === "string").slice(0, 20),
    fallbackUsed: false,
    relaxedFilters: [],
    aggregationField: deterministic.aggregationField ?? (() => {
      const field = raw.aggregationFieldKey ? fieldByKey.get(raw.aggregationFieldKey) : undefined;
      return field ? { fieldId: field.id, fieldKey: field.key } : undefined;
    })(),
    analyzerContext: deterministic.analyzerContext
  };
}

function filterOf(
  field: WorkspaceFieldDefinition,
  operator: QueryFilterOperator,
  value: string | string[],
  source: QueryFilter["source"],
  confidence: number,
  locked: boolean
): QueryFilter {
  return { fieldId: field.id, fieldKey: field.key, operator, value, source, confidence, locked };
}

function dedupeFilters(filters: QueryFilter[]) {
  return [...new Map(filters.map((filter) => [
    `${filter.fieldId}:${filter.operator}:${JSON.stringify(filter.value)}`,
    filter
  ])).values()];
}

function clampConfidence(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : .7;
}

function buildQueryAnalysisPrompt(
  query: string,
  fields: WorkspaceFieldDefinition[],
  candidates: EntityCandidate[],
  metadataCandidates: MetadataValueCandidate[],
  deterministic: QueryAnalysis
) {
  return `You are a query analyzer for a workspace-scoped archival retrieval system.
Return one JSON object only. Never invent field keys, entity IDs, values, dates, or numbers.
Valid queryType values: ENTITY_SEARCH, SEMANTIC_SEARCH, HYBRID_SEARCH.
Valid intent values: FIND, SUMMARIZE, COUNT, COMPARE, TIMELINE, EXISTS, DISTINCT, GROUP_BY, FACET.
Valid operators: EQ, CONTAINS, IN, GTE, LTE, BETWEEN.
Use ENTITY_SEARCH for listing/finding metadata or entities, SEMANTIC_SEARCH for conceptual content, and HYBRID_SEARCH for summaries, comparisons, or mixed requests.

<query>${JSON.stringify(query)}</query>
<fields>${JSON.stringify(fields.map((field) => ({ key: field.key, valueType: field.valueType, aliases: field.aliases, filterable: field.filterable })))}</fields>
<entity_candidates>${JSON.stringify(candidates)}</entity_candidates>
<metadata_value_candidates>${JSON.stringify(metadataCandidates)}</metadata_value_candidates>
<deterministic_analysis>${JSON.stringify(deterministic)}</deterministic_analysis>

Output shape:
{"queryType":"HYBRID_SEARCH","intent":"FIND","semanticQuery":"","filters":[{"fieldKey":"","operator":"EQ","value":"","confidence":0.0}],"matchedEntityIds":[],"aggregationFieldKey":"","unresolvedTerms":[]}`;
}

export function inferQueryIntent(query: string): QueryIntent {
  const normalized = normalizeForSearch(query);
  if (/\b(benzersiz|tekil|distinct|unique|kac farkli)\b/u.test(normalized)) return "DISTINCT";
  if (/\b(kac(?: adet)? belge(?:de|lerde)?|belge sayisi|how many documents|count documents?)\b/u.test(normalized)) return "COUNT";
  if (/\b(var mi|bulunuyor mu|mevcut mu|geciyor mu|exists?|any documents?)\b/u.test(normalized)) return "EXISTS";
  if (/\b(ilk hangi|en eski|en yeni|kronoloji|kronolojik|timeline|chronolog)\w*/u.test(normalized)) return "TIMELINE";
  if (/\b(karsilastir|kiyasla|compare|difference|farklari)\w*/u.test(normalized)) return "COMPARE";
  if (/\b(grupla|gruplandir|group by)\b/u.test(normalized)) return "GROUP_BY";
  if (/\b(facet|dagilim|kategorilere gore)\b/u.test(normalized)) return "FACET";
  if (/\b(ozetle|ozetini|ozet|summari[sz]e|summary)\b/u.test(normalized)) return "SUMMARIZE";
  return "FIND";
}

export function selectAnalyzerContext(
  query: string,
  fields: WorkspaceFieldDefinition[],
  entityCandidates: EntityCandidate[] = [],
  metadataCandidates: MetadataValueCandidate[] = [],
  limit = 20
) {
  const normalized = normalizeForSearch(query);
  const candidateFieldIds = new Set([...entityCandidates, ...metadataCandidates].map((candidate) => candidate.fieldId));
  const hasDate = /\b(?:19|20)\d{2}\b/u.test(normalized) || /\b(tarih|date|timeline|kronoloji|ilk|en eski|en yeni)\b/u.test(normalized);
  const scored = fields.map((field) => {
    const names = [field.key, field.label, ...field.aliases].map(normalizeForSearch);
    let score = candidateFieldIds.has(field.id) ? 100 : 0;
    if (names.some((name) => fieldNameMatches(normalized, name))) score += 80;
    if (hasDate && field.valueType === "DATE") score += 70;
    if (field.entityEnabled && entityCandidates.some((candidate) => candidate.fieldId === field.id)) score += 40;
    if (field.searchable) score += 1;
    return { field, score };
  }).sort((left, right) => right.score - left.score || left.field.key.localeCompare(right.field.key));
  const relevant = scored.filter((item) => item.score > 1);
  return (relevant.length ? relevant : scored).slice(0, Math.max(1, Math.min(50, limit))).map((item) => item.field);
}

function selectAggregationField(query: string, fields: WorkspaceFieldDefinition[]) {
  const normalized = normalizeForSearch(query);
  const field = fields
    .map((item) => ({ item, score: [item.key, item.label, ...item.aliases].map(normalizeForSearch).some((name) => fieldNameMatches(normalized, name)) ? 1 : 0 }))
    .sort((left, right) => right.score - left.score)
    .find((entry) => entry.score > 0)?.item;
  return field ? { fieldId: field.id, fieldKey: field.key } : undefined;
}

function fieldNameMatches(query: string, fieldName: string) {
  const queryTokens = query.replace(/_/g, " ").split(" ").filter(Boolean);
  const fieldTokens = fieldName.replace(/_/g, " ").split(" ").filter(Boolean);
  return fieldTokens.length > 0 && fieldTokens.every((fieldToken) =>
    queryTokens.some((queryToken) => queryToken === fieldToken
      || fieldToken.length >= 3 && queryToken.startsWith(fieldToken)
      || queryToken.length >= 3 && fieldToken.startsWith(queryToken))
  );
}

async function findEntityCandidates(config: ApiConfig, workspaceSlugInput: string, query: string, limit: number) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const [workspace] = await client.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return [];
    const normalized = normalizeForSearch(query);
    const rows = await client.queryClient<Array<{ id: string; field_id: string; field_key: string; canonical_value: string; normalized_value: string; score: number }>>`
      select distinct on (e.id)
        e.id, e.field_id, f.key as field_key, e.canonical_value, e.normalized_value,
        greatest(similarity(e.normalized_value, ${normalized}), coalesce(similarity(a.normalized_alias, ${normalized}), 0))::float8 as score
      from entities e
      join workspace_fields f on f.id = e.field_id
      left join entity_aliases a on a.entity_id = e.id
      where f.workspace_id = ${workspace.id}
        and f.searchable = true
        and (
          e.normalized_value % ${normalized}
          or a.normalized_alias % ${normalized}
          or ${normalized} like '%' || e.normalized_value || '%'
        )
      order by e.id, score desc
      limit ${limit}`;
    return rows.sort((left, right) => Number(right.score) - Number(left.score)).map((row) => ({
      id: row.id,
      fieldId: row.field_id,
      fieldKey: row.field_key,
      value: row.canonical_value,
      normalizedValue: row.normalized_value
    }));
  } finally {
    await client.close();
  }
}

async function findMetadataValueCandidates(config: ApiConfig, workspaceSlugInput: string, query: string, limit: number) {
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const [workspace] = await client.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return [];
    const normalized = normalizeForSearch(query);
    const rows = await client.queryClient<Array<{ field_id: string; field_key: string; text_value: string; normalized_value: string; score: number }>>`
      select distinct on (dfv.field_id, dfv.normalized_value)
        dfv.field_id, wf.key as field_key, dfv.text_value, dfv.normalized_value,
        similarity(dfv.normalized_value, ${normalized})::float8 as score
      from document_field_values dfv
      join workspace_fields wf on wf.id = dfv.field_id
      where wf.workspace_id = ${workspace.id}
        and wf.searchable = true
        and dfv.normalized_value is not null
        and length(dfv.normalized_value) between 1 and 256
        and (dfv.normalized_value % ${normalized} or ${normalized} like '%' || dfv.normalized_value || '%')
      order by dfv.field_id, dfv.normalized_value, score desc
      limit ${limit}`;
    return rows.sort((left, right) => Number(right.score) - Number(left.score)).map((row) => ({
      fieldId: row.field_id,
      fieldKey: row.field_key,
      value: row.text_value,
      normalizedValue: row.normalized_value
    }));
  } finally {
    await client.close();
  }
}

export function relaxQueryAnalysis(analysis: QueryAnalysis) {
  const relaxed = analysis.filters.filter((filter) => filter.source === "LLM" && !filter.locked && filter.confidence < .85);
  return {
    ...analysis,
    filters: analysis.filters.filter((filter) => !relaxed.includes(filter)),
    relaxedFilters: relaxed
  };
}

export async function resolveAnalysisDocumentIds(
  config: ApiConfig,
  workspaceSlugInput: string,
  analysis: QueryAnalysis
) {
  if (!analysis.filters.length && !analysis.matchedEntityIds.length) return undefined;
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlugInput);
    const [workspace] = await client.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return [];
    const encodedFilters = JSON.stringify(analysis.filters.map((filter) => ({
      fieldId: filter.fieldId,
      key: filter.fieldKey,
      operator: filter.operator,
      value: filter.value,
      normalizedValue: Array.isArray(filter.value)
        ? filter.value.map((value) => normalizeForSearch(value))
        : normalizeForSearch(filter.value)
    })));
    const entityIds = analysis.matchedEntityIds.length ? analysis.matchedEntityIds : null;
    const rows = await client.queryClient<Array<{ id: string }>>`
      select d.id
      from documents d
      where d.workspace_id = ${workspace.id} and d.status = 'INDEXED'
        and (${entityIds}::uuid[] is null or not exists (
          select 1 from unnest(${entityIds}::uuid[]) wanted_entity(entity_id)
          where not exists (
            select 1 from document_entities de
            where de.document_id = d.id and de.entity_id = wanted_entity.entity_id
          )
        ))
        and not exists (
          select 1
          from jsonb_array_elements(${encodedFilters}::jsonb) f
          where not exists (
            select 1
            from document_field_values dfv
            join workspace_fields wf on wf.id = dfv.field_id
            where dfv.document_id = d.id
              and wf.workspace_id = ${workspace.id}
              and wf.id = (f->>'fieldId')::uuid
              and case f->>'operator'
                when 'EQ' then dfv.normalized_value = (f->'normalizedValue' #>> '{}')
                when 'CONTAINS' then dfv.normalized_value like '%' || (f->'normalizedValue' #>> '{}') || '%'
                when 'IN' then exists (
                  select 1 from jsonb_array_elements_text(f->'normalizedValue') wanted(value)
                  where dfv.normalized_value = wanted.value
                )
                when 'GTE' then case
                  when dfv.date_value is not null and (f->'value' #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
                    then dfv.date_value >= (f->'value' #>> '{}')::date
                  when dfv.number_value is not null and (f->'value' #>> '{}') ~ '^-?\d+(\.\d+)?$'
                    then dfv.number_value >= (f->'value' #>> '{}')::real
                  else dfv.normalized_value >= (f->'normalizedValue' #>> '{}')
                end
                when 'LTE' then case
                  when dfv.date_value is not null and (f->'value' #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
                    then dfv.date_value <= (f->'value' #>> '{}')::date
                  when dfv.number_value is not null and (f->'value' #>> '{}') ~ '^-?\d+(\.\d+)?$'
                    then dfv.number_value <= (f->'value' #>> '{}')::real
                  else dfv.normalized_value <= (f->'normalizedValue' #>> '{}')
                end
                when 'BETWEEN' then case
                  when dfv.date_value is not null
                    and (f->'value'->>0) ~ '^\d{4}-\d{2}-\d{2}$'
                    and (f->'value'->>1) ~ '^\d{4}-\d{2}-\d{2}$'
                    then dfv.date_value between (f->'value'->>0)::date and (f->'value'->>1)::date
                  when dfv.number_value is not null
                    and (f->'value'->>0) ~ '^-?\d+(\.\d+)?$'
                    and (f->'value'->>1) ~ '^-?\d+(\.\d+)?$'
                    then dfv.number_value between (f->'value'->>0)::real and (f->'value'->>1)::real
                  else dfv.normalized_value between (f->'normalizedValue'->>0) and (f->'normalizedValue'->>1)
                end
                else false
              end
          )
        )`;
    return rows.map((row) => row.id);
  } finally {
    await client.close();
  }
}
