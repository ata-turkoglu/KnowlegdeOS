import type { QueryIntent } from "./query-analyzer.js";
import type { SemanticContextChunk } from "./semantic-search.js";

export type ApiEscalationDecision = { escalate: true } | { escalate: false; answer: string; reason: "SOCIAL" | "SOURCE_LISTING" };

function snippet(content: string, maximumLength = 420) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= maximumLength ? compact : `${compact.slice(0, maximumLength - 1)}…`;
}

export function decideApiEscalation(input: { question: string; intent: QueryIntent; context: SemanticContextChunk[] }): ApiEscalationDecision {
  const query = input.question.trim().toLocaleLowerCase("tr-TR");
  if (/^(merhaba|selam|günaydın|iyi günler|teşekkür(?:ler)?|sağ ol)[!.,\s]*$/iu.test(query)) {
    return { escalate: false, reason: "SOCIAL", answer: "Merhaba. Arşiv belgeleriyle ilgili arama, belge bulma ve özetleme konularında yardımcı olabilirim." };
  }
  const sourceListingRequest = /\b(hangi belge|belgeyi göster|belgeyi bul|kaynağı göster|kaynak belge)\b/iu.test(query);
  if (input.intent === "FIND" && sourceListingRequest && input.context.length === 1) {
    const source = input.context[0];
    return {
      escalate: false,
      reason: "SOURCE_LISTING",
      answer: `En ilgili kaynak: **${source.title || source.documentName}** (${source.documentName}).\n\n${snippet(source.content)} [1]`
    };
  }
  return { escalate: true };
}
