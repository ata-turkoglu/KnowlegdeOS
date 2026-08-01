import { normalizeForSearch } from '@knowledgeos/ingestion';
import type { QueryType } from '@knowledgeos/shared';
import { extractDateSearchVariants } from './date-search.js';

export type MetadataFilters = {
  year?: string;
  date?: string;
  documentType?: string;
  metadata?: Record<string, string>;
  workspace?: string;
  allowedDocumentIds?: string[];
};

export type RetrievalCandidate = {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  documentName: string;
  title: string;
  heading: string | null;
  content?: string;
  evidenceSnippet: string;
  sourceType: 'ENTITY' | 'SEMANTIC' | 'LEXICAL';
  score: number;
  retrievers?: string[];
};

export type LabeledNumericAnchor = {
  label: 'ada' | 'pafta' | 'parsel';
  value: string;
};

/**
 * Pafta, ada ve parsel gibi kısa fakat ayırt edici taşınmaz kimliklerini
 * sorgudan kayıpsız biçimde çıkarır.
 *
 * Hem "12 parsel" hem de "parsel no 12" yazımlarını aynı sorgu içinde
 * birlikte yakalar; tekrarlanan anchor değerlerini tekilleştirir.
 */
export function extractLabeledNumericAnchors(
  query: string,
): LabeledNumericAnchor[] {
  const normalized = normalizeForSearch(query);
  const anchors: LabeledNumericAnchor[] = [];

  for (const label of ['ada', 'pafta', 'parsel'] as const) {
    const patterns = [
      new RegExp(`\\b(\\d+(?:[/-]\\d+)?)\\s+${label}\\b`, 'gu'),
      new RegExp(
        `\\b${label}(?:\\s+(?:no|numara|numarali))?\\s+(\\d+(?:[/-]\\d+)?)\\b`,
        'gu',
      ),
    ];

    for (const pattern of patterns) {
      for (const match of normalized.matchAll(pattern)) {
        anchors.push({ label, value: match[1] });
      }
    }
  }

  return [
    ...new Map(
      anchors.map((anchor) => [`${anchor.label}:${anchor.value}`, anchor]),
    ).values(),
  ];
}

/**
 * Bir kanıt parçasının sorgudaki tüm etiketli sayısal anchor'ları taşıyıp
 * taşımadığını denetler.
 *
 * Eşleşmeler kelime sınırlarıyla yapılır; böylece "12" değerinin "112"
 * içinde yanlışlıkla eşleşmesi önlenir.
 */
export function evidenceMatchesLabeledAnchors(
  evidence: string,
  anchors: LabeledNumericAnchor[],
) {
  if (!anchors.length) return true;

  const normalized = normalizeForSearch(evidence);

  return anchors.every(({ label, value }) => {
    const escapedLabel = escapeRegExp(label);
    const escapedValue = escapeRegExp(value);

    return [
      new RegExp(`(?:^|\\s)${escapedValue}\\s+${escapedLabel}(?=\\s|$)`, 'u'),
      new RegExp(`(?:^|\\s)${escapedLabel}\\s+${escapedValue}(?=\\s|$)`, 'u'),
      new RegExp(
        `(?:^|\\s)${escapedLabel}\\s+(?:no|numara|numarali)\\s+${escapedValue}(?=\\s|$)`,
        'u',
      ),
    ].some((pattern) => pattern.test(normalized));
  });
}

/**
 * Kesin pafta, ada veya parsel kimliklerinin tamamını aynı parçada taşıyan
 * adayları listenin başına alır.
 *
 * Hiçbir aday tüm anchor'ları karşılamıyorsa mevcut sıralama korunur.
 */
export function prioritizeCandidatesByQueryAnchors(
  query: string,
  candidates: RetrievalCandidate[],
) {
  const anchors = extractLabeledNumericAnchors(query);
  if (!anchors.length) return candidates;

  const matching: RetrievalCandidate[] = [];
  const remaining: RetrievalCandidate[] = [];

  for (const candidate of candidates) {
    const evidence = candidate.content ?? candidate.evidenceSnippet;
    if (evidenceMatchesLabeledAnchors(evidence, anchors)) {
      matching.push(candidate);
    } else {
      remaining.push(candidate);
    }
  }

  return matching.length ? [...matching, ...remaining] : candidates;
}

/**
 * Eski retrieval çağrıları için sorgudan temel tarih, yıl ve belge türü
 * filtrelerini deterministik olarak çıkarır.
 *
 * ISO tarihlerin yanında Türkçe arşivlerde sık görülen gün.ay.yıl,
 * gün/ay/yıl ve gün-ay-yıl yazımlarını da ISO biçimine dönüştürür.
 */
export function extractMetadataFilters(query: string): MetadataFilters {
  const date = extractDateSearchVariants(query)?.iso;
  const year = date?.slice(0, 4) ?? query.match(/\b(?:19|20)\d{2}\b/u)?.[0];
  const documentType = normalizeForSearch(query).match(
    /\b(tapu|vekaletname|mahkeme|dilekce)\b/u,
  )?.[1];

  return {
    ...(date ? { date } : {}),
    ...(year ? { year } : {}),
    ...(documentType ? { documentType } : {}),
  };
}

/**
 * Metadata kısıtları nedeniyle tüm retriever'lar boş döndüğünde filtresiz
 * bir kurtarma denemesinin gerekli olup olmadığını belirler.
 *
 * Workspace ve izin verilen belge kimlikleri güvenlik/kapsam sınırı olduğu
 * için gevşetilebilir metadata filtresi olarak değerlendirilmez.
 */
export function shouldRetryWithoutMetadata(
  filters: MetadataFilters,
  counts: { entity: number; semantic: number; lexical: number },
) {
  const hasRelaxableMetadata =
    Boolean(filters.year || filters.date || filters.documentType) ||
    Boolean(filters.metadata && Object.keys(filters.metadata).length);

  return (
    hasRelaxableMetadata &&
    counts.entity + counts.semantic + counts.lexical === 0
  );
}

/**
 * Farklı retriever'ların ham skorlarını karşılaştırmadan, yalnızca sıra
 * konumlarını kullanarak Reciprocal Rank Fusion uygular.
 *
 * Aynı adayın tek bir listede tekrar etmesi ek puan üretmez; retriever
 * kaynakları sonuç üzerinde tekilleştirilerek korunur.
 */
export function reciprocalRankFusion(
  lists: RetrievalCandidate[][],
  k = 60,
): RetrievalCandidate[] {
  const safeK = Number.isFinite(k) && k >= 0 ? k : 60;
  const fused = new Map<
    string,
    RetrievalCandidate & { fused: number; kinds: Set<string> }
  >();

  for (const list of lists) {
    const seenInList = new Set<string>();

    list.forEach((candidate, index) => {
      const key = `${candidate.documentId}:${candidate.chunkId}`;
      if (seenInList.has(key)) return;
      seenInList.add(key);

      const existing = fused.get(key);
      const contribution = 1 / (safeK + index + 1);

      if (existing) {
        existing.fused += contribution;
        existing.kinds.add(candidate.sourceType);
        for (const retriever of candidate.retrievers ?? []) {
          existing.kinds.add(retriever);
        }
        return;
      }

      fused.set(key, {
        ...candidate,
        fused: contribution,
        kinds: new Set([candidate.sourceType, ...(candidate.retrievers ?? [])]),
      });
    });
  }

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.fused - left.fused ||
        left.documentName.localeCompare(right.documentName) ||
        left.chunkIndex - right.chunkIndex,
    )
    .map(({ fused, kinds, ...candidate }) => ({
      ...candidate,
      score: fused,
      retrievers: [...kinds].sort(),
    }));
}

/**
 * Model cevabındaki [n] citation biçimlerini kaynak sayısı ve cevaplanabilirlik
 * kurallarına göre doğrular.
 */
export function validateCitations(
  answer: string,
  sourceCount: number,
  answerable: boolean,
) {
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );
  const emptyAnswer = answer.trim().length < 3;
  const outOfRange = citations.some(
    (value) => value < 1 || value > sourceCount,
  );
  const missingCitation = answerable && citations.length === 0;

  return {
    valid: !emptyAnswer && !outOfRange && !missingCitation,
    citations,
    errors: [
      ...(emptyAnswer ? ['empty_answer'] : []),
      ...(outOfRange ? ['citation_out_of_range'] : []),
      ...(missingCitation ? ['missing_citation'] : []),
    ],
  };
}

/**
 * Cevap veya sorgu içindeki tarih, belge numarası, parsel ve diğer sayısal
 * kimlikleri doğrulama amacıyla çıkarır.
 */
export function lockedQueryValues(query: string) {
  return numericValueTokens(query);
}

const citationStopWords = new Set([
  'acik',
  'ad',
  'ama',
  'ancak',
  'bir',
  'bu',
  'cin',
  'cok',
  'daha',
  'de',
  'degil',
  'den',
  'gibi',
  'hem',
  'icin',
  'ile',
  'ise',
  'kadar',
  'ki',
  'mi',
  'mu',
  'musu',
  'ne',
  'olan',
  'olarak',
  'orta',
  'sonra',
  'sadece',
  'su',
  'tarafindan',
  'tum',
  'uzere',
  'var',
  've',
  'veya',
  'ya',
  'yani',
]);

/**
 * Her citation grubunun hemen öncesindeki doğrulanabilir iddiayı gerçekten
 * destekleyen bir kaynağa işaret edip etmediğini denetler.
 */
export function validateCitationEvidence(answer: string, evidence: string[]) {
  const groups = [...answer.matchAll(/(?:\[\d+\](?:\s*[,;]\s*)?)+/g)];

  if (!groups.length) {
    return { valid: true, errors: [] as string[] };
  }

  const errors = new Set<string>();
  let cursor = 0;

  for (const group of groups) {
    const groupIndex = group.index ?? 0;
    const claim = answer.slice(cursor, groupIndex).trim();
    const citations = [...group[0].matchAll(/\[(\d+)\]/g)].map((match) =>
      Number(match[1]),
    );

    if (hasVerifiableClaim(claim)) {
      for (const citation of citations) {
        const source = evidence[citation - 1];
        if (source && !sourceSupportsClaim(source, claim)) {
          errors.add(`citation_evidence_mismatch:${citation}`);
        }
      }
    }

    cursor = groupIndex + group[0].length;
  }

  if (hasVerifiableClaim(answer.slice(cursor))) {
    errors.add('uncited_claim');
  }

  return {
    valid: errors.size === 0,
    errors: [...errors],
  };
}

/**
 * Bir metin parçasının kaynak gösterimi gerektiren doğrulanabilir bir iddia
 * taşıyıp taşımadığını belirler.
 */
function hasVerifiableClaim(value: string) {
  return (
    lockedQueryValues(value).length > 0 || meaningfulTerms(value).length > 0
  );
}

/**
 * Bir kaynağın iddiadaki sayısal değerleri ve yeterli sayıda anlamlı terimi
 * içerip içermediğini denetler.
 */
function sourceSupportsClaim(source: string, claim: string) {
  const normalizedSource = normalizeForSearch(source);
  const sourceNumericValues = new Set(
    numericValueTokens(normalizedSource).map(normalizeNumericValue),
  );

  if (
    lockedQueryValues(claim).some(
      (value) => !sourceNumericValues.has(normalizeNumericValue(value)),
    )
  ) {
    return false;
  }

  const claimTerms = meaningfulTerms(claim);
  if (!claimTerms.length) return true;

  const sourceTerms = new Set(normalizedSource.split(/\s+/u).filter(Boolean));
  const overlappingTerms = claimTerms.filter((term) =>
    sourceTerms.has(term),
  ).length;

  return overlappingTerms >= Math.min(2, Math.ceil(claimTerms.length * 0.35));
}

/**
 * Citation denetiminde kullanılacak anlamlı ve tekil sorgu terimlerini çıkarır.
 */
function meaningfulTerms(value: string) {
  return [
    ...new Set(
      normalizeForSearch(value)
        .split(/\s+/u)
        .filter(
          (term) =>
            term.length >= 3 &&
            !citationStopWords.has(term) &&
            !/^\d/u.test(term),
        ),
    ),
  ];
}

export interface Reranker {
  rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    topK: number;
  }): Promise<RetrievalCandidate[]>;
}

/**
 * Adayların mevcut sırasını değiştirmeden yalnızca ilk `topK` sonucu döndürür.
 */
export class NoopReranker implements Reranker {
  async rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    topK: number;
  }) {
    return input.candidates.slice(0, normalizeTopK(input.topK));
  }
}

/**
 * Çevrimdışı fallback sıralayıcıdır.
 *
 * Sorgu ile kanıt arasındaki anlamlı token örtüşmesini mevcut aday sırasıyla
 * birleştirerek deterministik ve düşük maliyetli bir skor üretir.
 */
export class LexicalOverlapReranker implements Reranker {
  async rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    topK: number;
  }) {
    const queryTerms = new Set(
      meaningfulTerms(input.query).filter((term) => term.length >= 2),
    );

    return input.candidates
      .map((candidate, index) => {
        const evidenceTerms = new Set(
          normalizeForSearch(
            `${candidate.title} ${candidate.heading ?? ''} ${
              candidate.content ?? candidate.evidenceSnippet
            }`,
          )
            .split(/\s+/u)
            .filter(Boolean),
        );

        const overlap =
          [...queryTerms].filter((term) => evidenceTerms.has(term)).length /
          Math.max(1, queryTerms.size);

        return {
          candidate,
          score: overlap * 0.7 + (1 / (index + 1)) * 0.3,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.documentName.localeCompare(
            right.candidate.documentName,
          ) ||
          left.candidate.chunkIndex - right.candidate.chunkIndex,
      )
      .slice(0, normalizeTopK(input.topK))
      .map(({ candidate, score }) => ({ ...candidate, score }));
  }
}

export type LlmRanking = {
  rankings?: Array<{ id?: string; score?: number }>;
};

/**
 * Adayların sınırlı bir bölümünü küçük modele sıralatır.
 *
 * Model geçersiz kimlik, tekrar eden aday veya geçersiz skor döndürürse bunları
 * reddeder; kullanılabilir sonuç kalmazsa lexical fallback sıralayıcıya geçer.
 */
export class LlmReranker implements Reranker {
  constructor(
    private readonly rankWithModel: (input: {
      query: string;
      candidates: RetrievalCandidate[];
    }) => Promise<LlmRanking>,
    private readonly fallback: Reranker = new LexicalOverlapReranker(),
    private readonly modelCandidateLimit = 12,
  ) {}

  async rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    topK: number;
  }) {
    const topK = normalizeTopK(input.topK);
    if (input.candidates.length < 2) {
      return input.candidates.slice(0, topK);
    }

    const candidateLimit = Math.max(
      2,
      Math.min(input.candidates.length, Math.trunc(this.modelCandidateLimit)),
    );
    const modelCandidates = input.candidates.slice(0, candidateLimit);

    try {
      const response = await this.rankWithModel({
        query: input.query,
        candidates: modelCandidates,
      });
      const allowed = new Map(
        modelCandidates.map((candidate) => [candidate.chunkId, candidate]),
      );
      const ranked: Array<{
        candidate: RetrievalCandidate;
        score: number;
        modelIndex: number;
      }> = [];
      const seen = new Set<string>();

      for (const [modelIndex, item] of (response.rankings ?? []).entries()) {
        const candidate = item.id ? allowed.get(item.id) : undefined;
        const score = Number(item.score);

        if (
          !candidate ||
          seen.has(candidate.chunkId) ||
          !Number.isFinite(score)
        ) {
          continue;
        }

        seen.add(candidate.chunkId);
        ranked.push({
          candidate,
          score: Math.max(0, Math.min(1, score)),
          modelIndex,
        });
      }

      if (!ranked.length) {
        throw new Error('Reranker returned no valid candidate IDs.');
      }

      // Model sırası ile model skoru çelişirse skor önceliklidir; eşit
      // skorlarda modelin verdiği sıra korunur.
      ranked.sort(
        (left, right) =>
          right.score - left.score || left.modelIndex - right.modelIndex,
      );

      const rankedCandidates = ranked.map(({ candidate, score }) => ({
        ...candidate,
        score,
      }));
      const remaining = input.candidates.filter(
        (candidate) => !seen.has(candidate.chunkId),
      );

      return [...rankedCandidates, ...remaining].slice(0, topK);
    } catch {
      return this.fallback.rerank({ ...input, topK });
    }
  }
}

/**
 * Cevaptaki tarih ve sayıların seçili kanıtların en az birinde gerçekten
 * bulunup bulunmadığını deterministik olarak denetler.
 */
export function validateEvidenceValues(answer: string, evidence: string[]) {
  const withoutCitations = answer.replace(/\[\d+\]/g, '');
  const values = lockedQueryValues(withoutCitations);
  const supportedValues = new Set(
    numericValueTokens(evidence.join(' ')).map(normalizeNumericValue),
  );
  const unsupported = [
    ...new Set(
      values.filter(
        (value) => !supportedValues.has(normalizeNumericValue(value)),
      ),
    ),
  ];

  return {
    valid: unsupported.length === 0,
    unsupported,
  };
}

/**
 * Metin içindeki tarih, ondalık sayı ve bölümlü belge/parsel numaralarını
 * bütün token olarak çıkarır.
 */
function numericValueTokens(value: string) {
  return (
    value.match(
      /(?<![\p{L}\p{N}])(?:\d{1,4}[./:-]\d{1,2}[./:-]\d{1,4}|\d+(?:[./:-]\d+)+|\d+)(?![\p{L}\p{N}])/gu,
    ) ?? []
  );
}

/**
 * Tarih ve sayısal kimliklerde nokta, eğik çizgi ve tire farklılıklarını
 * karşılaştırılabilir ortak biçime dönüştürür.
 */
function normalizeNumericValue(value: string) {
  const trimmed = value.trim();

  const dateParts = trimmed.match(/^(\d{1,4})[./:-](\d{1,2})[./:-](\d{1,4})$/);
  if (dateParts) {
    const [, first, second, third] = dateParts;

    if (first.length === 4) {
      return `${first.padStart(4, '0')}-${second.padStart(2, '0')}-${third.padStart(2, '0')}`;
    }

    if (third.length === 4) {
      return `${third.padStart(4, '0')}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    }
  }

  return trimmed.replace(/[./:]/g, '-');
}

/**
 * Kullanıcı veya plan tarafından gelen topK değerini güvenli bir aralığa sınırlar.
 */
function normalizeTopK(topK: number) {
  if (!Number.isFinite(topK)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(topK)));
}

/**
 * Dinamik regex parçalarında özel karakterlerin desen anlamı kazanmasını engeller.
 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
