import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EntityType } from "@knowledgeos/shared";
import { normalizeForSearch, type ExtractedEntity } from "@knowledgeos/ingestion";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import { ensureWorkspaceStorage, getWorkspaceStoragePaths } from "./storage.js";
import type { IndexedDocumentMetadata } from "./documents.js";

export type EntityAlias = {
  alias: string;
  normalizedAlias: string;
  confidence: number;
  source: "REGEX" | "FRONTMATTER" | "USER" | "IMPORT";
};

export type EntityDocumentLink = {
  documentName: string;
  title: string;
  markdownPath: string;
  occurrenceCount: number;
  evidenceSnippet: string;
  confidence: number;
};

export type CanonicalEntity = {
  id: string;
  workspaceSlug: string;
  type: EntityType;
  canonicalValue: string;
  normalizedValue: string;
  aliases: EntityAlias[];
  documents: EntityDocumentLink[];
  createdAt: string;
  updatedAt: string;
};

export type EntityIndex = {
  version: 1;
  workspaceSlug: string;
  updatedAt: string;
  entities: CanonicalEntity[];
};

type EntityCandidate = ExtractedEntity & {
  document: EntityDocumentLink;
};

export async function rebuildEntityIndex(config: ApiConfig, workspaceSlugInput: string) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const paths = await ensureWorkspaceStorage(config.storageRoot, workspaceSlug);
  const metadataFiles = await readdir(paths.metadata);
  const candidates: EntityCandidate[] = [];

  for (const fileName of metadataFiles) {
    if (!fileName.endsWith(".json") || fileName === "workspace.json" || fileName === "entities.json") {
      continue;
    }

    const filePath = path.join(paths.metadata, fileName);
    const metadata = JSON.parse(await readFile(filePath, "utf8")) as Partial<IndexedDocumentMetadata>;

    if (metadata.status !== "INDEXED" || !metadata.ingestion) {
      continue;
    }

    const documentName = path.parse(fileName).name;

    for (const entity of metadata.ingestion.entities) {
      candidates.push({
        ...entity,
        document: {
          documentName,
          title: metadata.title ?? documentName,
          markdownPath: metadata.markdownPath ?? "",
          occurrenceCount: 1,
          evidenceSnippet: entity.evidenceSnippet,
          confidence: entity.confidence
        }
      });
    }
  }

  const index = mergeCandidatesIntoIndex(workspaceSlug, candidates);
  await writeEntityIndex(config, index);

  return index;
}

export async function readEntityIndex(config: ApiConfig, workspaceSlugInput: string) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspaceSlug);
  const indexPath = path.join(paths.metadata, "entities.json");

  try {
    return JSON.parse(await readFile(indexPath, "utf8")) as EntityIndex;
  } catch {
    return rebuildEntityIndex(config, workspaceSlug);
  }
}

export async function listEntities(config: ApiConfig, workspaceSlugInput: string) {
  const index = await readEntityIndex(config, workspaceSlugInput);
  return index.entities;
}

export async function getEntity(
  config: ApiConfig,
  workspaceSlugInput: string,
  entityId: string
) {
  const index = await readEntityIndex(config, workspaceSlugInput);
  const entity = index.entities.find((item) => item.id === entityId);

  if (!entity) {
    throw new HttpError(404, "Entity not found.");
  }

  return entity;
}

export async function addEntityAlias(
  config: ApiConfig,
  workspaceSlugInput: string,
  entityId: string,
  alias: string
) {
  const cleanAlias = alias.trim();

  if (!cleanAlias) {
    throw new HttpError(400, "Alias is required.");
  }

  const index = await readEntityIndex(config, workspaceSlugInput);
  const entity = index.entities.find((item) => item.id === entityId);

  if (!entity) {
    throw new HttpError(404, "Entity not found.");
  }

  addAlias(entity, {
    alias: cleanAlias,
    normalizedAlias: normalizeForSearch(cleanAlias),
    confidence: 1,
    source: "USER"
  });
  entity.updatedAt = new Date().toISOString();
  index.updatedAt = entity.updatedAt;
  await writeEntityIndex(config, index);

  return entity;
}

export async function mergeEntities(
  config: ApiConfig,
  workspaceSlugInput: string,
  sourceEntityId: string,
  targetEntityId: string
) {
  if (sourceEntityId === targetEntityId) {
    throw new HttpError(400, "Source and target entities must be different.");
  }

  const index = await readEntityIndex(config, workspaceSlugInput);
  const source = index.entities.find((item) => item.id === sourceEntityId);
  const target = index.entities.find((item) => item.id === targetEntityId);

  if (!source || !target) {
    throw new HttpError(404, "Entity not found.");
  }

  if (source.type !== target.type) {
    throw new HttpError(400, "Only entities with the same type can be merged.");
  }

  addAlias(target, {
    alias: source.canonicalValue,
    normalizedAlias: source.normalizedValue,
    confidence: 1,
    source: "USER"
  });

  for (const alias of source.aliases) {
    addAlias(target, alias);
  }

  for (const document of source.documents) {
    addDocumentLink(target, document);
  }

  target.updatedAt = new Date().toISOString();
  index.entities = index.entities.filter((item) => item.id !== source.id);
  index.updatedAt = target.updatedAt;
  await writeEntityIndex(config, index);

  return target;
}

export function mergeCandidatesIntoIndex(
  workspaceSlug: string,
  candidates: EntityCandidate[]
): EntityIndex {
  const now = new Date().toISOString();
  const entities: CanonicalEntity[] = [];

  for (const candidate of candidates) {
    const groupKey = entityGroupKey(candidate);
    let entity = entities.find((item) => shouldMergeEntity(item, candidate));

    if (!entity) {
      entity = {
        id: entityId(workspaceSlug, candidate.type, groupKey),
        workspaceSlug,
        type: candidate.type,
        canonicalValue: candidate.value,
        normalizedValue: candidate.normalizedValue,
        aliases: [],
        documents: [],
        createdAt: now,
        updatedAt: now
      };
      entities.push(entity);
    }

    if (candidate.value.length > entity.canonicalValue.length) {
      entity.canonicalValue = candidate.value;
      entity.normalizedValue = candidate.normalizedValue;
    }

    addAlias(entity, {
      alias: candidate.value,
      normalizedAlias: candidate.normalizedValue,
      confidence: candidate.confidence,
      source: candidate.source
    });
    addDocumentLink(entity, candidate.document);
  }

  return {
    version: 1,
    workspaceSlug,
    updatedAt: now,
    entities: entities.sort((a, b) => a.canonicalValue.localeCompare(b.canonicalValue, "tr"))
  };
}

function entityGroupKey(entity: Pick<CanonicalEntity, "type" | "normalizedValue">) {
  if (entity.type !== "PERSON") {
    return entity.normalizedValue;
  }

  const parts = entity.normalizedValue.split(" ").filter(Boolean);
  const surname = parts.at(-1) ?? entity.normalizedValue;
  const initial = parts[0]?.[0] ?? "";

  return initial ? `${initial}:${surname}` : surname;
}

function shouldMergeEntity(
  existing: Pick<CanonicalEntity, "type" | "normalizedValue">,
  candidate: Pick<EntityCandidate, "type" | "normalizedValue">
) {
  if (existing.type !== candidate.type) {
    return false;
  }

  if (existing.type !== "PERSON") {
    return existing.normalizedValue === candidate.normalizedValue;
  }

  const existingParts = existing.normalizedValue.split(" ").filter(Boolean);
  const candidateParts = candidate.normalizedValue.split(" ").filter(Boolean);
  const existingSurname = existingParts.at(-1) ?? existing.normalizedValue;
  const candidateSurname = candidateParts.at(-1) ?? candidate.normalizedValue;
  const existingInitial = existingParts[0]?.[0];
  const candidateInitial = candidateParts[0]?.[0];

  if (existingInitial && candidateInitial && existingInitial !== candidateInitial) {
    return false;
  }

  return (
    existingSurname === candidateSurname ||
    levenshteinDistance(existingSurname, candidateSurname) <= 2
  );
}

function levenshteinDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );

  for (let row = 0; row <= left.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= right.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[left.length][right.length];
}

function addAlias(entity: CanonicalEntity, alias: EntityAlias) {
  if (
    entity.aliases.some(
      (existing) => existing.normalizedAlias === alias.normalizedAlias
    )
  ) {
    return;
  }

  entity.aliases.push(alias);
  entity.aliases.sort((a, b) => a.alias.localeCompare(b.alias, "tr"));
}

function addDocumentLink(entity: CanonicalEntity, document: EntityDocumentLink) {
  const existing = entity.documents.find(
    (item) => item.documentName === document.documentName
  );

  if (existing) {
    existing.occurrenceCount += document.occurrenceCount;
    existing.confidence = Math.max(existing.confidence, document.confidence);
    return;
  }

  entity.documents.push(document);
  entity.documents.sort((a, b) => a.documentName.localeCompare(b.documentName, "tr"));
}

async function writeEntityIndex(config: ApiConfig, index: EntityIndex) {
  const paths = await ensureWorkspaceStorage(config.storageRoot, index.workspaceSlug);
  const indexPath = path.join(paths.metadata, "entities.json");
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function entityId(workspaceSlug: string, type: EntityType, groupKey: string) {
  return createHash("sha1")
    .update(`${workspaceSlug}:${type}:${groupKey}`)
    .digest("hex")
    .slice(0, 16);
}
