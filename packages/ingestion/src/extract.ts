import type { EntityType, MetadataValue } from "@knowledgeos/shared";
import { normalizeForSearch } from "./normalize.js";

export type ExtractedEntity = {
  type: EntityType;
  value: string;
  normalizedValue: string;
  evidenceSnippet: string;
  confidence: number;
  source: "REGEX" | "FRONTMATTER" | "LLM";
};

export type ExtractedPropertyReference = {
  place: string | null;
  normalizedPlace: string | null;
  sheet: string | null;
  block: string | null;
  parcel: string;
  normalizedKey: string;
  evidenceSnippet: string;
  confidence: number;
  source: "REGEX" | "FRONTMATTER";
};

type ExtractionInput = {
  content: string;
  frontmatter: Record<string, MetadataValue>;
};

const extractionPatterns: Array<{
  type: EntityType;
  pattern: RegExp;
  confidence: number;
}> = [
  {
    type: "DATE",
    pattern: /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?:18|19|20)\d{2})\b/g,
    confidence: 0.88
  },
  {
    type: "PARCEL",
    pattern: /\b(?:(?:ada|pafta|parsel)\s*(?:no|numara|numarası)?[:\s-]*\d+[A-Za-z/-]*|\d+[A-Za-z/-]*\s*(?:ada|pafta|parsel))\b/giu,
    confidence: 0.9
  },
  {
    type: "CASE_NUMBER",
    pattern: /\b(?:esas|karar|dava)\s*(?:no|numara|numarası)?[:\s-]*\d{2,4}\/\d+\b/giu,
    confidence: 0.88
  },
  {
    type: "NOTARY_NUMBER",
    pattern: /\b(?:yevmiye|noter)\s*(?:no|numara|numarası)?[:\s-]*\d+\b/giu,
    confidence: 0.86
  }
];

const personPattern =
  /\b\p{Lu}[\p{L}'’.-]{1,}(?:[ \t]+\p{Lu}\.)?(?:[ \t]+\p{Lu}[\p{L}'’.-]{1,}){1,3}\b/gu;
const abbreviatedPersonPattern = /\b\p{Lu}\.[ \t]+\p{Lu}[\p{L}'’.-]{1,}(?:[ \t]+\p{Lu}[\p{L}'’.-]{1,}){0,2}\b/gu;

const ignoredPersonStarts = new Set([
  "Bu",
  "Eğer",
  "KnowledgeOS",
  "Markdown",
  "ChatGPT",
  "PDF",
  "JPG",
  "PNG",
  "TIFF"
]);
const ignoredPersonValues = new Set(["Knowledge Graph"]);
const ignoredPersonTerms = new Set([
  "akbank", "anonim", "bakanligi", "bankasi", "belediye", "dairesi", "genel",
  "hukuk", "icra", "kadastro", "mahkeme", "mahkemesi", "memurlugu",
  "mudurlugu", "noter", "sicil", "sirketi", "tapusu", "vergi"
]);
const ignoredPersonTermPrefixes = [
  "bank", "bakan", "belediye", "daire", "gumruk", "hukuk", "icra",
  "kadastro", "kooperatif", "mahkem", "memurl", "mudur", "noter",
  "sirket", "tapu", "vergi", "vezne"
];

export function deterministicExtract(input: ExtractionInput) {
  const entities: ExtractedEntity[] = [];

  addFrontmatterEntities(entities, input.frontmatter);

  for (const config of extractionPatterns) {
    for (const match of input.content.matchAll(config.pattern)) {
      const value = match[0].trim();
      entities.push({
        type: config.type,
        value,
        normalizedValue: normalizeForSearch(value),
        evidenceSnippet: snippetAround(input.content, match.index ?? 0, value.length),
        confidence: config.confidence,
        source: "REGEX"
      });
    }
  }

  const personSearchContent = input.content
    .split("\n")
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .filter((line) => !/^```/.test(line.trim()))
    .join("\n");

  addPersonMatches(entities, personSearchContent, personPattern, 0.72);
  addPersonMatches(entities, personSearchContent, abbreviatedPersonPattern, 0.74);

  return dedupeEntities(entities);
}

export function extractPropertyReferences(input: ExtractionInput): ExtractedPropertyReference[] {
  const descriptions = metadataValues(input.frontmatter.property_descriptions);
  const candidates = [
    ...descriptions.map((evidence) => ({ evidence, source: "FRONTMATTER" as const, confidence: 0.98 })),
    ...propertyEvidenceSegments(input.content).map((evidence) => ({ evidence, source: "REGEX" as const, confidence: 0.9 }))
  ];
  const places = metadataValues(input.frontmatter.places);
  const references: ExtractedPropertyReference[] = [];

  for (const candidate of candidates) {
    const anchors = labeledPropertyValues(candidate.evidence);
    if (!anchors.parsel) continue;
    const normalizedEvidence = normalizeForSearch(candidate.evidence);
    const matchedPlace = places
      .map((place) => ({ place, normalized: normalizeForSearch(place) }))
      .find(({ normalized }) => normalizedEvidence.includes(normalized));
    const place = matchedPlace?.place ?? (places.length === 1 ? places[0] : null);
    const normalizedPlace = place ? normalizeForSearch(place) : null;
    const normalizedKey = [normalizedPlace ?? "-", anchors.pafta ?? "-", anchors.ada ?? "-", anchors.parsel].join("|");

    references.push({
      place,
      normalizedPlace,
      sheet: anchors.pafta ?? null,
      block: anchors.ada ?? null,
      parcel: anchors.parsel,
      normalizedKey,
      evidenceSnippet: candidate.evidence.replace(/\s+/g, " ").trim().slice(0, 600),
      confidence: candidate.confidence,
      source: candidate.source
    });
  }

  const byKey = new Map<string, ExtractedPropertyReference>();
  for (const reference of references) {
    const existing = byKey.get(reference.normalizedKey);
    if (!existing || existing.confidence < reference.confidence) byKey.set(reference.normalizedKey, reference);
  }
  return [...byKey.values()];
}

function addPersonMatches(
  entities: ExtractedEntity[],
  content: string,
  pattern: RegExp,
  confidence: number
) {
  for (const match of content.matchAll(pattern)) {
    const value = cleanPersonCandidate(match[0]);
    const firstWord = value.split(/\s+/)[0];

    if (
      !value ||
      ignoredPersonStarts.has(firstWord) ||
      ignoredPersonValues.has(value) ||
      looksInstitutionalPerson(value) ||
      value.length > 80
    ) {
      continue;
    }

    entities.push({
      type: "PERSON",
      value,
      normalizedValue: normalizeForSearch(value),
      evidenceSnippet: snippetAround(content, match.index ?? 0, match[0].length),
      confidence,
      source: "REGEX"
    });
  }
}

function looksInstitutionalPerson(value: string) {
  return normalizeForSearch(value).split(" ").some((term) =>
    ignoredPersonTerms.has(term) || ignoredPersonTermPrefixes.some((prefix) => term.startsWith(prefix))
  );
}

function cleanPersonCandidate(value: string) {
  return value
    .trim()
    .replace(/^(?:(?:Av|Rh|Dr|Prof|No\.lu|T\.C|TL)\.?\s+)+/u, "")
    .replace(/[’'][a-zçğıöşü]{1,4}$/iu, "")
    .trim();
}

function addFrontmatterEntities(
  entities: ExtractedEntity[],
  frontmatter: Record<string, MetadataValue>
) {
  const mappings: Array<{ key: string; type: EntityType }> = [
    { key: "people", type: "PERSON" },
    { key: "places", type: "PLACE" },
    { key: "addresses", type: "PLACE" },
    { key: "parcels", type: "PARCEL" },
    { key: "property_descriptions", type: "PROPERTY" },
    { key: "organizations", type: "ORGANIZATION" },
    { key: "document_type", type: "DOCUMENT_TYPE" },
    { key: "date", type: "DATE" },
    { key: "case_numbers", type: "CASE_NUMBER" },
    { key: "notary_numbers", type: "NOTARY_NUMBER" },
    { key: "keywords", type: "KEYWORD" }
  ];

  for (const mapping of mappings) {
    const rawValue = frontmatter[mapping.key];
    const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];

    for (const value of values) {
      const text = String(value).trim();
      if (!text) {
        continue;
      }
      const type = mapping.type === "PERSON" && looksInstitutionalPerson(text)
        ? "ORGANIZATION"
        : mapping.type;

      entities.push({
        type,
        value: text,
        normalizedValue: normalizeForSearch(text),
        evidenceSnippet: `frontmatter:${mapping.key}`,
        confidence: 0.98,
        source: "FRONTMATTER"
      });
    }
  }
}

function dedupeEntities(entities: ExtractedEntity[]) {
  const byKey = new Map<string, ExtractedEntity>();

  for (const entity of entities) {
    const key = `${entity.type}:${entity.normalizedValue}`;
    const existing = byKey.get(key);

    if (!existing || existing.confidence < entity.confidence) {
      if (entity.evidenceSnippet.startsWith("frontmatter:") && existing && !existing.evidenceSnippet.startsWith("frontmatter:")) {
        entity.evidenceSnippet = existing.evidenceSnippet;
      }
      byKey.set(key, entity);
    } else if (existing.evidenceSnippet.startsWith("frontmatter:") && !entity.evidenceSnippet.startsWith("frontmatter:")) {
      existing.evidenceSnippet = entity.evidenceSnippet;
    }
  }

  return [...byKey.values()].sort((a, b) => a.type.localeCompare(b.type));
}

function metadataValues(value: MetadataValue | undefined) {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((item) => String(item).trim()).filter(Boolean);
}

function propertyEvidenceSegments(content: string) {
  return content
    .split(/\n+|(?<=[.;!?])\s+/u)
    .map((segment) => segment.trim())
    .filter((segment) => /\bparsel\b/iu.test(segment) && /\d/u.test(segment))
    .filter((segment) => segment.length <= 1_200);
}

function labeledPropertyValues(value: string) {
  const normalized = normalizeForSearch(value);
  const result: Partial<Record<"ada" | "pafta" | "parsel", string>> = {};
  for (const label of ["ada", "pafta", "parsel"] as const) {
    const before = normalized.match(new RegExp(`\\b(\\d+(?:[/-]\\d+)?)\\s+${label}\\b`, "u"))?.[1];
    const after = normalized.match(new RegExp(`\\b${label}(?:\\s+(?:no|numara|numarasi))?\\s+(\\d+(?:[/-]\\d+)?)\\b`, "u"))?.[1];
    result[label] = before ?? after;
  }
  return result;
}

function snippetAround(content: string, index: number, length: number) {
  const start = Math.max(0, index - 80);
  const end = Math.min(content.length, index + length + 80);

  return content.slice(start, end).replace(/\s+/g, " ").trim();
}
