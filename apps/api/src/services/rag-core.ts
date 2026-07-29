import { normalizeForSearch } from "@knowledgeos/ingestion";
import type { QueryType } from "@knowledgeos/shared";

export type MetadataFilters = {
  year?: string;
  date?: string;
  documentType?: string;
  metadata?: Record<string, string>;
  workspace?: string;
  allowedDocumentIds?: string[];
};
export type RetrievalCandidate = { documentId: string; chunkId: string; chunkIndex: number; documentName: string; title: string; heading: string | null; content?: string; evidenceSnippet: string; sourceType: "ENTITY" | "SEMANTIC" | "LEXICAL"; score: number; retrievers?: string[] };
export type LabeledNumericAnchor = { label: "ada" | "pafta" | "parsel"; value: string };

/** Pafta/parsel gibi kısa fakat ayırt edici taşınmaz kimliklerini sorgudan kayıpsız çıkarır. */
export function extractLabeledNumericAnchors(query: string): LabeledNumericAnchor[] {
  const normalized = normalizeForSearch(query);
  const anchors: LabeledNumericAnchor[] = [];
  for (const label of ["ada", "pafta", "parsel"] as const) {
    const valueBeforeLabel = [...normalized.matchAll(new RegExp(`\\b(\\d+(?:[/-]\\d+)?)\\s+${label}\\b`, "gu"))];
    const matches = valueBeforeLabel.length
      ? valueBeforeLabel
      : [...normalized.matchAll(new RegExp(`\\b${label}(?:\\s+no)?\\s+(\\d+(?:[/-]\\d+)?)\\b`, "gu"))];
    for (const match of matches) anchors.push({ label, value: match[1] });
  }
  return [...new Map(anchors.map((anchor) => [`${anchor.label}:${anchor.value}`, anchor])).values()];
}

export function evidenceMatchesLabeledAnchors(evidence: string, anchors: LabeledNumericAnchor[]) {
  if (!anchors.length) return true;
  const normalized = ` ${normalizeForSearch(evidence)} `;
  return anchors.every(({ label, value }) =>
    normalized.includes(` ${value} ${label} `)
    || normalized.includes(` ${label} ${value} `)
    || normalized.includes(` ${label} no ${value} `)
  );
}

/**
 * Kesin pafta/parsel kimliklerinin tamamını aynı parçada taşıyan adayları öne alır.
 * Diğer adaylar korunur; böylece genel RAG yapısı ve geri dönüş davranışı değişmez.
 */
export function prioritizeCandidatesByQueryAnchors(query: string, candidates: RetrievalCandidate[]) {
  const anchors = extractLabeledNumericAnchors(query);
  if (!anchors.length) return candidates;
  const matching: RetrievalCandidate[] = [];
  const remaining: RetrievalCandidate[] = [];
  for (const candidate of candidates) {
    const evidence = candidate.content ?? candidate.evidenceSnippet;
    (evidenceMatchesLabeledAnchors(evidence, anchors) ? matching : remaining).push(candidate);
  }
  return matching.length ? [...matching, ...remaining] : candidates;
}

export function extractMetadataFilters(query: string): MetadataFilters {
  const date = query.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const year = date?.slice(0, 4) ?? query.match(/\b(19|20)\d{2}\b/)?.[0];
  const documentType = normalizeForSearch(query).match(/\b(tapu|vekaletname|mahkeme|dilekce)\b/u)?.[1];
  return { ...(date ? { date } : {}), ...(year ? { year } : {}), ...(documentType ? { documentType } : {}) };
}

export function shouldRetryWithoutMetadata(filters: MetadataFilters, counts: { entity: number; semantic: number; lexical: number }) {
  return Object.keys(filters).length > 0 && counts.entity + counts.semantic + counts.lexical === 0;
}

/** Rank-only fusion: raw scores from heterogeneous retrievers are never compared. */
export function reciprocalRankFusion(lists: RetrievalCandidate[][], k = 60): RetrievalCandidate[] {
  const fused = new Map<string, RetrievalCandidate & { fused: number; kinds: Set<string> }>();
  for (const list of lists) list.forEach((candidate, index) => {
    const key = `${candidate.documentId}:${candidate.chunkId}`;
    const existing = fused.get(key);
    if (existing) { existing.fused += 1 / (k + index + 1); existing.kinds.add(candidate.sourceType); return; }
    fused.set(key, { ...candidate, fused: 1 / (k + index + 1), kinds: new Set([candidate.sourceType]) });
  });
  return [...fused.values()].sort((a, b) => b.fused - a.fused || a.documentName.localeCompare(b.documentName) || a.chunkIndex - b.chunkIndex)
    .map(({ fused, kinds, ...candidate }) => ({ ...candidate, score: fused, retrievers: [...kinds].sort() }));
}

export function validateCitations(answer: string, sourceCount: number, answerable: boolean) {
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  const valid = answer.trim().length >= 3 && citations.every((value) => value >= 1 && value <= sourceCount) && (!answerable || citations.length > 0);
  return { valid, citations, errors: [
    ...(answer.trim().length < 3 ? ["empty_answer"] : []),
    ...(citations.some((value) => value < 1 || value > sourceCount) ? ["citation_out_of_range"] : []),
    ...(answerable && citations.length === 0 ? ["missing_citation"] : [])
  ] };
}

export function lockedQueryValues(query: string) { return normalizeForSearch(query).match(/\b\d{4}(?:[-/]\d{2}(?:[-/]\d{2})?)?\b|\b\d+[\/]?\d*\b/g) ?? []; }

const citationStopWords = new Set(["acik", "ad", "ama", "ancak", "bir", "bu", "cin", "cok", "daha", "de", "degil", "den", "gibi", "hem", "icin", "ile", "ise", "kadar", "ki", "mi", "mu", "musu", "ne", "olan", "olarak", "orta", "sonra", "sadece", "su", "tarafindan", "tum", "uzere", "var", "ve", "veya", "ya", "yani"]);

/** Her citation grubunun, kendisinden önceki iddiayı gerçekten destekleyen kaynaklara işaret ettiğini denetler. */
export function validateCitationEvidence(answer: string, evidence: string[]) {
  const groups = [...answer.matchAll(/(?:\[\d+\](?:\s*[,;]\s*)?)+/g)];
  if (!groups.length) return { valid: true, errors: [] as string[] };
  const errors: string[] = [];
  let cursor = 0;
  for (const group of groups) {
    const claim = answer.slice(cursor, group.index).trim();
    const citations = [...group[0].matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    if (hasVerifiableClaim(claim)) {
      for (const citation of citations) {
        const source = evidence[citation - 1];
        if (source && !sourceSupportsClaim(source, claim)) errors.push(`citation_evidence_mismatch:${citation}`);
      }
    }
    cursor = (group.index ?? 0) + group[0].length;
  }
  if (hasVerifiableClaim(answer.slice(cursor))) errors.push("uncited_claim");
  return { valid: errors.length === 0, errors };
}

function hasVerifiableClaim(value: string) {
  return lockedQueryValues(value).length > 0 || meaningfulTerms(value).length > 0;
}

function sourceSupportsClaim(source: string, claim: string) {
  const normalizedSource = normalizeForSearch(source);
  if (lockedQueryValues(claim).some((value) => !normalizedSource.includes(normalizeForSearch(value)))) return false;
  const claimTerms = meaningfulTerms(claim);
  if (!claimTerms.length) return true;
  const sourceTerms = new Set(normalizedSource.split(" "));
  const overlappingTerms = claimTerms.filter((term) => sourceTerms.has(term)).length;
  return overlappingTerms >= Math.min(2, Math.ceil(claimTerms.length * .35));
}

function meaningfulTerms(value: string) {
  return [...new Set(normalizeForSearch(value).split(" ").filter((term) => term.length >= 3 && !citationStopWords.has(term)))];
}

export interface Reranker { rerank(input: { query: string; candidates: RetrievalCandidate[]; topK: number }): Promise<RetrievalCandidate[]>; }
export class NoopReranker implements Reranker { async rerank(input: { query: string; candidates: RetrievalCandidate[]; topK: number }) { return input.candidates.slice(0, input.topK); } }
/** Offline reranker: combines fused rank with normalized query/evidence token overlap. */
export class LexicalOverlapReranker implements Reranker {
  async rerank(input: { query: string; candidates: RetrievalCandidate[]; topK: number }) {
    const queryTerms = new Set(normalizeForSearch(input.query).split(" ").filter((term) => term.length >= 2));
    return input.candidates.map((candidate, index) => {
      const evidenceTerms = new Set(normalizeForSearch(`${candidate.title} ${candidate.heading ?? ""} ${candidate.content ?? candidate.evidenceSnippet}`).split(" "));
      const overlap = [...queryTerms].filter((term) => evidenceTerms.has(term)).length / Math.max(1, queryTerms.size);
      return { candidate, score: overlap * .7 + (1 / (index + 1)) * .3 };
    }).sort((left, right) => right.score - left.score || left.candidate.documentName.localeCompare(right.candidate.documentName))
      .slice(0, input.topK).map(({ candidate, score }) => ({ ...candidate, score }));
  }
}

export type LlmRanking = { rankings?: Array<{ id?: string; score?: number }> };
export class LlmReranker implements Reranker {
  constructor(
    private readonly rankWithModel: (input: { query: string; candidates: RetrievalCandidate[] }) => Promise<LlmRanking>,
    private readonly fallback: Reranker = new LexicalOverlapReranker(),
    private readonly modelCandidateLimit = 12
  ) {}

  async rerank(input: { query: string; candidates: RetrievalCandidate[]; topK: number }) {
    if (input.candidates.length < 2) return input.candidates.slice(0, input.topK);
    const modelCandidates = input.candidates.slice(0, this.modelCandidateLimit);
    try {
      const response = await this.rankWithModel({ query: input.query, candidates: modelCandidates });
      const allowed = new Map(modelCandidates.map((candidate) => [candidate.chunkId, candidate]));
      const ranked: RetrievalCandidate[] = [];
      const seen = new Set<string>();
      for (const item of response.rankings ?? []) {
        const candidate = item.id ? allowed.get(item.id) : undefined;
        if (!candidate || seen.has(candidate.chunkId) || !Number.isFinite(item.score)) continue;
        seen.add(candidate.chunkId);
        ranked.push({ ...candidate, score: Math.max(0, Math.min(1, Number(item.score))) });
      }
      if (!ranked.length) throw new Error("Reranker returned no valid candidate IDs.");
      const remaining = input.candidates.filter((candidate) => !seen.has(candidate.chunkId));
      return [...ranked, ...remaining].slice(0, input.topK);
    } catch {
      return this.fallback.rerank(input);
    }
  }
}

/** Conservative groundedness guard for dates/numbers, the easiest hallucinations to verify deterministically. */
export function validateEvidenceValues(answer: string, evidence: string[]) {
  const withoutCitations = answer.replace(/\[\d+\]/g, "");
  const values = lockedQueryValues(withoutCitations);
  const normalizedEvidence = normalizeForSearch(evidence.join(" "));
  const unsupported = values.filter((value) => !normalizedEvidence.includes(normalizeForSearch(value)));
  return { valid: unsupported.length === 0, unsupported };
}
