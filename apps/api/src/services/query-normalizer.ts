import type { ApiConfig } from "../config/env.js";
import { getSmallLlmProvider } from "./ai-providers.js";
import { recordSmallModelMetric } from "./small-model-metrics.js";

export type QueryNormalization = {
  originalQuery: string;
  normalizedQuery: string;
  searchQueries: string[];
  corrections: Array<{ from: string; to: string; confidence: number }>;
  fallbackUsed: boolean;
};

type RawNormalization = { normalizedQuery?: string; searchQueries?: string[]; corrections?: Array<{ from?: string; to?: string; confidence?: number }> };

function deterministicNormalize(query: string) {
  return query.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function numericTokens(query: string) { return query.match(/\d+(?:[./:-]\d+)*/g) ?? []; }

function validCandidate(value: unknown, original: string) {
  if (typeof value !== "string") return null;
  const normalized = deterministicNormalize(value);
  if (!normalized || normalized.length > 1_000) return null;
  const requiredNumbers = numericTokens(original);
  return requiredNumbers.every((token) => normalized.includes(token)) ? normalized : null;
}

export async function normalizeQuery(config: ApiConfig, input: { query: string; signal?: AbortSignal }): Promise<QueryNormalization> {
  const originalQuery = input.query.trim();
  const fallback = deterministicNormalize(originalQuery);
  if (!fallback) return { originalQuery, normalizedQuery: fallback, searchQueries: [], corrections: [], fallbackUsed: true };
  recordSmallModelMetric("queryNormalizer", "attempt");
  try {
    const raw = await getSmallLlmProvider(config, "queryNormalizer").generateJsonObject<RawNormalization>(`<task>
Normalize a user query for multilingual archival retrieval.
</task>
<rules>
- Correct only obvious spelling, spacing, keyboard-layout, and OCR errors.
- Preserve the original language, intent, names, quoted text, document codes, dates, and every numeric token exactly.
- Do not add concepts, synonyms, filters, or facts that are absent from the query.
- normalizedQuery must be a minimally edited version of the input.
- Provide 1 to 3 concise searchQueries, ordered from most faithful to broadest. Every search query must preserve all numeric tokens.
- Report only changes actually made. Confidence must be between 0 and 1.
- Return exactly one valid JSON object and no other text.
</rules>
<query>${JSON.stringify(originalQuery)}</query>
<output_schema>{"normalizedQuery":"","searchQueries":[""],"corrections":[{"from":"","to":"","confidence":0.0}]}</output_schema>`, input.signal);
    const normalizedQuery = validCandidate(raw.normalizedQuery, originalQuery) ?? fallback;
    const searchQueries = [...new Set([normalizedQuery, ...(raw.searchQueries ?? []).map((item) => validCandidate(item, originalQuery)).filter((item): item is string => Boolean(item))])].slice(0, 3);
    const corrections = (raw.corrections ?? []).flatMap((item) => typeof item.from === "string" && typeof item.to === "string" && Number.isFinite(item.confidence) && item.from && item.to ? [{ from: item.from, to: item.to, confidence: Math.max(0, Math.min(1, Number(item.confidence))) }] : []).slice(0, 12);
    recordSmallModelMetric("queryNormalizer", "success");
    if (normalizedQuery !== fallback || corrections.length) recordSmallModelMetric("queryNormalizer", "accepted");
    return { originalQuery, normalizedQuery, searchQueries, corrections, fallbackUsed: false };
  } catch {
    recordSmallModelMetric("queryNormalizer", "fallback");
    return { originalQuery, normalizedQuery: fallback, searchQueries: [fallback], corrections: [], fallbackUsed: true };
  }
}
