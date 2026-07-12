import { normalizeForSearch } from "@knowledgeos/ingestion";
import type { QueryType } from "@knowledgeos/shared";

export function classifyQuery(query: string): QueryType {
  const normalized = normalizeForSearch(query);

  if (
    normalized.includes("ozetle") ||
    normalized.includes("karsilastir") ||
    normalized.includes("gecen belgeleri")
  ) {
    return "HYBRID_SEARCH";
  }

  if (
    normalized.includes("hangi belgelerde") ||
    normalized.includes("geciyor mu") ||
    normalized.includes("geciyor") ||
    normalized.includes("listele")
  ) {
    return "ENTITY_SEARCH";
  }

  return "SEMANTIC_SEARCH";
}
