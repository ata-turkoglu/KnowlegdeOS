import {
  getMetadataFieldPolicy,
  metadataFieldPolicies,
  type MetadataScalar,
  type MetadataValue,
} from '@knowledgeos/shared';
import { canonicalizeDateValue } from './workspace-fields.js';

export type MetadataCandidate = { key: string; value: MetadataScalar; chunkIndex: number; source: 'llm' | 'derived'; evidence?: string };
export type MetadataDiagnostics = { issues: string[]; candidates: MetadataCandidate[]; rejected: MetadataCandidate[] };

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('tr-TR').replace(/[*_`]/g, '').replace(/\s*:\s*/g, ':').replace(/\s+/g, ' ').trim();
const usable = (value: unknown): value is MetadataScalar => (typeof value === 'string' && Boolean(value.trim())) || typeof value === 'number' || typeof value === 'boolean';

/** Validates each provider response against the shared field registry without losing chunk provenance. */
export function collectMetadataCandidates(value: unknown, chunkIndex: number, diagnostics: MetadataDiagnostics) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.issues.push(`chunk ${chunkIndex}: response is not a JSON object`);
    return;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const policy = getMetadataFieldPolicy(key);
    if (!policy || policy.merge === 'system') {
      diagnostics.issues.push(`chunk ${chunkIndex}: rejected unknown or system field ${key}`);
      continue;
    }
    const values = Array.isArray(raw) ? raw : [raw];
    if (policy.semanticType === 'scalar' && Array.isArray(raw)) diagnostics.issues.push(`chunk ${chunkIndex}: scalar field ${key} returned as an array`);
    if (policy.semanticType === 'list' && !Array.isArray(raw)) diagnostics.issues.push(`chunk ${chunkIndex}: list field ${key} returned as a scalar`);
    for (const item of values) {
      if (!usable(item)) {
        if (item !== null && typeof item === 'object') diagnostics.issues.push(`chunk ${chunkIndex}: rejected nested value for ${key}`);
        continue;
      }
      if (typeof item !== 'string' && policy.valueType === 'TEXT') {
        diagnostics.issues.push(`chunk ${chunkIndex}: rejected non-text value for ${key}`);
        continue;
      }
      diagnostics.candidates.push({ key: policy.key, value: typeof item === 'string' ? item.trim() : item, chunkIndex, source: 'llm' });
    }
  }
}

function sourceSupported(value: MetadataScalar, source: string) {
  return normalize(source).includes(normalize(String(value)));
}

function unique(candidates: MetadataCandidate[]) {
  const values = new Map<string, MetadataCandidate>();
  for (const candidate of candidates) {
    const key = normalize(String(candidate.value));
    if (key && !values.has(key)) values.set(key, candidate);
  }
  return [...values.values()];
}

function score(candidate: MetadataCandidate, candidates: MetadataCandidate[], source: string, key: string) {
  const text = String(candidate.value).trim();
  if (!text || /(?:\(\?\)|�|\b(?:unknown|unreadable)\b)/iu.test(text)) return -1000;
  const matching = candidates.filter((item) => normalize(String(item.value)) === normalize(text)).length;
  const index = normalize(source).indexOf(normalize(text));
  let result = matching * 100 + (index >= 0 ? 40 : 0) - Math.min(text.length, 600) / 20;
  if (key === 'title' && /^#{1,6}\s+/m.test(source) && source.match(/^#{1,6}\s+(.+)$/m)?.[1]?.includes(text)) result += 100;
  if (key === 'language' && /^[a-z]{2}$/i.test(text)) result += 60;
  if (text.length > 280) result -= 200;
  return result;
}

function chooseBest(key: string, candidates: MetadataCandidate[], source: string) {
  return [...unique(candidates)].sort((left, right) => score(right, candidates, source, key) - score(left, candidates, source, key) || left.chunkIndex - right.chunkIndex || String(left.value).localeCompare(String(right.value), 'tr'))[0];
}

function chooseDatePair(candidates: MetadataCandidate[], source: string, diagnostics: MetadataDiagnostics) {
  const dates = candidates.filter((candidate) => candidate.key === 'date' && typeof candidate.value === 'string').map((candidate) => ({ ...candidate, iso: canonicalizeDateValue(String(candidate.value)) }));
  const texts = candidates.filter((candidate) => candidate.key === 'date_text' && typeof candidate.value === 'string');
  const valid = dates.filter((candidate) => candidate.iso);
  const selected = chooseBest('date', valid.map((candidate) => ({ ...candidate, value: candidate.iso! })), source);
  if (!selected || typeof selected.value !== 'string') return {};
  const fullDateText = (candidate: MetadataCandidate) => /(?:\d{1,2}[./ -]){2}\d{4}|\d{1,2}\s+\p{L}+\s+\d{4}/u.test(String(candidate.value));
  const paired = texts.filter((candidate) => candidate.chunkIndex === selected.chunkIndex && sourceSupported(candidate.value, source) && fullDateText(candidate));
  const matchingText = chooseBest('date_text', paired.length ? paired : texts.filter((candidate) => sourceSupported(candidate.value, source) && fullDateText(candidate)), source);
  if (!matchingText) diagnostics.issues.push(`selected date ${selected.value} has no source-supported date_text`);
  return { date: selected.value, ...(matchingText ? { date_text: matchingText.value } : {}) };
}

/** Resolves collected candidates once per document; scalar fields cannot become arrays. */
export function resolveMetadataCandidates(candidates: MetadataCandidate[], source: string, diagnostics: MetadataDiagnostics): Record<string, MetadataValue> {
  const resolved: Record<string, MetadataValue> = {};
  Object.assign(resolved, chooseDatePair(candidates, source, diagnostics));
  for (const policy of metadataFieldPolicies) {
    if (policy.merge === 'system' || policy.key === 'date' || policy.key === 'date_text') continue;
    const values = candidates.filter((candidate) => candidate.key === policy.key);
    const supported = policy.grounding === 'required' ? values.filter((candidate) => sourceSupported(candidate.value, source)) : values;
    if (policy.semanticType === 'list') {
      const union = unique(supported).map((candidate) => candidate.value);
      if (union.length) resolved[policy.key] = union;
      continue;
    }
    if (policy.merge === 'concat') {
      const fragments = unique(supported).map((candidate) => String(candidate.value)).filter(Boolean);
      if (fragments.length) resolved[policy.key] = fragments.join('\n').slice(0, 4000);
      continue;
    }
    if (policy.merge === 'date') {
      const valid = supported.filter((candidate) => typeof candidate.value === 'string' && canonicalizeDateValue(candidate.value));
      const chosen = chooseBest(policy.key, valid.map((candidate) => ({ ...candidate, value: canonicalizeDateValue(String(candidate.value))! })), source);
      if (chosen) resolved[policy.key] = chosen.value;
      continue;
    }
    const chosen = chooseBest(policy.key, supported, source);
    if (chosen) resolved[policy.key] = chosen.value;
  }
  if (!resolved.language) resolved.language = 'tr';
  return resolved;
}

export function createMetadataDiagnostics(): MetadataDiagnostics { return { issues: [], candidates: [], rejected: [] }; }

/** Final guard before YAML output; built-in contracts must never depend on serializer heuristics. */
export function validateMetadataForSerialization(metadata: Record<string, MetadataValue>) {
  for (const [key, value] of Object.entries(metadata)) {
    const policy = getMetadataFieldPolicy(key);
    if (!policy) throw new Error(`Cannot serialize unregistered metadata field: ${key}`);
    if (policy.semanticType === 'scalar' && Array.isArray(value)) throw new Error(`Cannot serialize scalar metadata field ${key} as an array.`);
    if (policy.semanticType === 'list' && !Array.isArray(value)) throw new Error(`Cannot serialize list metadata field ${key} as a scalar.`);
  }
}
