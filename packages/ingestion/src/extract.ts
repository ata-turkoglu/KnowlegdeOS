import type { EntityType } from "@knowledgeos/shared";
import { normalizeForSearch } from "./normalize.js";

export type ExtractedEntity = {
  type: EntityType;
  value: string;
  normalizedValue: string;
  evidenceSnippet: string;
  confidence: number;
  source: "REGEX" | "FRONTMATTER";
};

type ExtractionInput = {
  content: string;
  frontmatter: Record<string, string | string[]>;
};

const extractionPatterns: Array<{
  type: EntityType;
  pattern: RegExp;
  confidence: number;
}> = [
  {
    type: "DATE",
    pattern: /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4})\b/g,
    confidence: 0.88
  },
  {
    type: "PARCEL",
    pattern: /\b(?:ada|pafta|parsel)\s*(?:no|numara|numarası)?[:\s-]*\d+[A-Za-z/-]*\b/giu,
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
  /\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,}(?:\s+[A-ZÇĞİÖŞÜ]\.)?(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,}){1,3}\b/g;
const abbreviatedPersonPattern = /\b[A-ZÇĞİÖŞÜ]\.\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,}\b/g;

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

function addPersonMatches(
  entities: ExtractedEntity[],
  content: string,
  pattern: RegExp,
  confidence: number
) {
  for (const match of content.matchAll(pattern)) {
    const value = match[0].trim();
    const firstWord = value.split(/\s+/)[0];

    if (
      ignoredPersonStarts.has(firstWord) ||
      ignoredPersonValues.has(value) ||
      value.length > 80
    ) {
      continue;
    }

    entities.push({
      type: "PERSON",
      value,
      normalizedValue: normalizeForSearch(value),
      evidenceSnippet: snippetAround(content, match.index ?? 0, value.length),
      confidence,
      source: "REGEX"
    });
  }
}

function addFrontmatterEntities(
  entities: ExtractedEntity[],
  frontmatter: Record<string, string | string[]>
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
    { key: "date_text", type: "DATE" },
    { key: "case_numbers", type: "CASE_NUMBER" },
    { key: "notary_numbers", type: "NOTARY_NUMBER" },
    { key: "keywords", type: "KEYWORD" }
  ];

  for (const mapping of mappings) {
    const rawValue = frontmatter[mapping.key];
    const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];

    for (const value of values) {
      if (!value.trim()) {
        continue;
      }

      entities.push({
        type: mapping.type,
        value,
        normalizedValue: normalizeForSearch(value),
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
      byKey.set(key, entity);
    }
  }

  return [...byKey.values()].sort((a, b) => a.type.localeCompare(b.type));
}

function snippetAround(content: string, index: number, length: number) {
  const start = Math.max(0, index - 80);
  const end = Math.min(content.length, index + length + 80);

  return content.slice(start, end).replace(/\s+/g, " ").trim();
}
