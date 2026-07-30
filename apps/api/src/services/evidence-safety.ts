import type { SemanticContextChunk } from "./semantic-search.js";

export type EvidenceSafetyResult = { chunks: SemanticContextChunk[]; removedInstructions: number; redactions: number };

const injectionPatterns = [
  /\b(ignore|disregard|forget)\b.{0,80}\b(previous|prior|system|instructions?)\b/iu,
  /\b(system prompt|developer message|jailbreak|do not follow the above)\b/iu,
  /\b(önceki|yukarıdaki)\b.{0,80}\b(talimat|yönerge|komut)\b.{0,80}\b(yoksay|unut|görmezden gel)/iu,
  /\brolünü değiştir|sistem mesajını göster|kuralları atla\b/iu
];

const piiPatterns: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[E-POSTA MASKELENDİ]"],
  [/\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/giu, "[IBAN MASKELENDİ]"],
  [/\b(?:\+90|0)?\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/gu, "[TELEFON MASKELENDİ]"],
  [/\b\d{11}\b/gu, "[KİMLİK NO MASKELENDİ]"],
  [/\b(?:\d[ -]*?){13,19}\b/gu, "[KART NO MASKELENDİ]"]
];

function redactPii(value: string) {
  let redactions = 0;
  let safe = value;
  for (const [pattern, replacement] of piiPatterns) {
    safe = safe.replace(pattern, () => { redactions++; return replacement; });
  }
  return { safe, redactions };
}

export function secureEvidenceForApi(chunks: SemanticContextChunk[]): EvidenceSafetyResult {
  let removedInstructions = 0;
  let redactions = 0;
  const safeChunks = chunks.map((chunk) => {
    const withoutInstructions = chunk.content.split(/\r?\n/).map((line) => {
      if (!injectionPatterns.some((pattern) => pattern.test(line))) return line;
      removedInstructions++;
      return "[GÜVENİLMEYEN KAYNAK TALİMATI ÇIKARILDI]";
    }).join("\n");
    const masked = redactPii(withoutInstructions);
    redactions += masked.redactions;
    return { ...chunk, content: masked.safe };
  });
  return { chunks: safeChunks, removedInstructions, redactions };
}
