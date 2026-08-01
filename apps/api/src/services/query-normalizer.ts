import type { ApiConfig } from '../config/env.js';
import { getSmallLlmProvider } from './ai-providers.js';
import { recordSmallModelMetric } from './small-model-metrics.js';

export type QueryNormalization = {
  originalQuery: string;
  normalizedQuery: string;
  searchQueries: string[];
  corrections: Array<{ from: string; to: string; confidence: number }>;
  fallbackUsed: boolean;
};

type RawNormalization = {
  normalizedQuery?: string;
  searchQueries?: string[];
  corrections?: Array<{ from?: string; to?: string; confidence?: number }>;
};

/**
 * Sorgudaki Unicode birleşimlerini, görünmez karakterleri ve gereksiz boşlukları
 * deterministik biçimde temizler. Anlam, yazım veya kelime seçimi üzerinde değişiklik yapmaz.
 */
function deterministicNormalize(query: string) {
  return query
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tarih, belge kodu, pafta/parsel ve benzeri yapılarda geçen sayısal tokenları
 * kaynak sırasını koruyarak çıkarır.
 */
function numericTokens(query: string) {
  return query.match(/\d+(?:[./:-]\d+)*/g) ?? [];
}

/**
 * Aday sorgunun, orijinal sorgudaki tüm sayısal tokenları aynı sıra ve adetle
 * koruyup korumadığını doğrular.
 */
function hasSameNumericTokens(original: string, candidate: string) {
  const originalTokens = numericTokens(original);
  const candidateTokens = numericTokens(candidate);

  if (originalTokens.length !== candidateTokens.length) return false;
  return originalTokens.every(
    (token, index) => token === candidateTokens[index],
  );
}

/**
 * Model tarafından üretilen normalize edilmiş sorgu adayını uzunluk, içerik ve
 * sayısal token bütünlüğü açısından doğrular. Geçersiz adaylarda null döndürür.
 */
function validCandidate(value: unknown, original: string) {
  if (typeof value !== 'string') return null;

  const normalized = deterministicNormalize(value);
  if (!normalized || normalized.length > 1_000) return null;
  if (!hasSameNumericTokens(original, normalized)) return null;

  return normalized;
}

/**
 * Modelin bildirdiği düzeltmelerin gerçekten orijinal ve normalize edilmiş
 * sorgularda karşılığı olup olmadığını denetler ve güvenli correction listesini üretir.
 */
function validateCorrections(
  rawCorrections: RawNormalization['corrections'],
  originalQuery: string,
  normalizedQuery: string,
) {
  return (rawCorrections ?? [])
    .flatMap((item) => {
      if (
        typeof item.from !== 'string' ||
        typeof item.to !== 'string' ||
        !Number.isFinite(item.confidence)
      ) {
        return [];
      }

      const from = deterministicNormalize(item.from);
      const to = deterministicNormalize(item.to);

      if (
        !from ||
        !to ||
        from === to ||
        !originalQuery.includes(from) ||
        !normalizedQuery.includes(to) ||
        !hasSameNumericTokens(from, to)
      ) {
        return [];
      }

      return [
        {
          from,
          to,
          confidence: Math.max(0, Math.min(1, Number(item.confidence))),
        },
      ];
    })
    .slice(0, 12);
}

/**
 * Kullanıcı sorgusunu arşiv aramasına uygun şekilde minimum düzeyde normalize eder.
 * Model çıktısı geçersiz olduğunda deterministik normalizasyona geri döner ve
 * arama sorgularında hem kaynak biçimi hem de güvenli alternatifleri korur.
 */
export async function normalizeQuery(
  config: ApiConfig,
  input: { query: string; signal?: AbortSignal },
): Promise<QueryNormalization> {
  const rawOriginalQuery = input.query.trim();
  const originalQuery = deterministicNormalize(rawOriginalQuery);
  const fallback = originalQuery;

  if (!fallback) {
    return {
      originalQuery: rawOriginalQuery,
      normalizedQuery: fallback,
      searchQueries: [],
      corrections: [],
      fallbackUsed: true,
    };
  }

  recordSmallModelMetric('queryNormalizer', 'attempt');

  try {
    const raw = await getSmallLlmProvider(
      config,
      'queryNormalizer',
    ).generateJsonObject<RawNormalization>(
      `<task>
Normalize a user query for multilingual archival retrieval.
</task>
<rules>
- Correct only obvious spelling, spacing, keyboard-layout, and OCR errors.
- Preserve the original language, intent, quoted text, document codes, dates, and every numeric token exactly.
- Never correct a person's, place's, organization's, document's, or parcel's spelling solely because another spelling looks more common.
- For uncertain proper names, preserve the original form in normalizedQuery and place possible alternatives only in searchQueries.
- Do not add concepts, synonyms, filters, or facts that are absent from the query.
- normalizedQuery must be a minimally edited version of the input.
- Provide 1 to 3 concise searchQueries, ordered from most faithful to broadest. Every search query must preserve all numeric tokens exactly and in the same order.
- Report only changes actually made. Confidence must be between 0 and 1.
- Return exactly one valid JSON object and no other text.
</rules>
<query>${JSON.stringify(fallback)}</query>
<output_schema>{"normalizedQuery":"","searchQueries":[""],"corrections":[{"from":"","to":"","confidence":0.0}]}</output_schema>`,
      input.signal,
    );

    const validatedNormalizedQuery = validCandidate(
      raw.normalizedQuery,
      fallback,
    );
    const normalizedQuery = validatedNormalizedQuery ?? fallback;
    const fallbackUsed = validatedNormalizedQuery === null;

    const modelSearchQueries = (raw.searchQueries ?? [])
      .map((item) => validCandidate(item, fallback))
      .filter((item): item is string => Boolean(item));

    // Orijinal/deterministik sorgu ilk sırada tutulur; model düzeltmesi yanlış olsa
    // bile arşivdeki özgün yazım üzerinden arama yapma imkânı kaybolmaz.
    const searchQueries = [
      ...new Set([fallback, normalizedQuery, ...modelSearchQueries]),
    ].slice(0, 3);

    const corrections = validateCorrections(
      raw.corrections,
      fallback,
      normalizedQuery,
    );

    recordSmallModelMetric('queryNormalizer', 'success');
    if (fallbackUsed) {
      recordSmallModelMetric('queryNormalizer', 'fallback');
    } else if (
      normalizedQuery !== fallback ||
      corrections.length > 0 ||
      searchQueries.length > 1
    ) {
      recordSmallModelMetric('queryNormalizer', 'accepted');
    }

    return {
      originalQuery: rawOriginalQuery,
      normalizedQuery,
      searchQueries,
      corrections,
      fallbackUsed,
    };
  } catch {
    recordSmallModelMetric('queryNormalizer', 'fallback');
    return {
      originalQuery: rawOriginalQuery,
      normalizedQuery: fallback,
      searchQueries: [fallback],
      corrections: [],
      fallbackUsed: true,
    };
  }
}
