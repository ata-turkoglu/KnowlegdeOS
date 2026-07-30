import type { IngestionResult } from "@knowledgeos/ingestion";

export type IngestionQualityIssue = { chunkIndex: number; code: "TOO_SHORT" | "DUPLICATE" | "OCR_ARTIFACTS" | "LOW_TEXT_DENSITY"; severity: "warning" | "error" };
export type IngestionQualityReport = { checkedChunkCount: number; issueCount: number; issues: IngestionQualityIssue[] };

export function inspectIngestionQuality(chunks: IngestionResult["chunks"]): IngestionQualityReport {
  const issues: IngestionQualityIssue[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const compact = chunk.content.replace(/\s+/g, " ").trim();
    const normalized = chunk.normalizedContent.replace(/\s+/g, " ").trim();
    if (compact.length < 40) issues.push({ chunkIndex: chunk.chunkIndex, code: "TOO_SHORT", severity: "warning" });
    if (normalized && seen.has(normalized)) issues.push({ chunkIndex: chunk.chunkIndex, code: "DUPLICATE", severity: "warning" });
    seen.add(normalized);
    const artifacts = (chunk.content.match(/�|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
    if (artifacts) issues.push({ chunkIndex: chunk.chunkIndex, code: "OCR_ARTIFACTS", severity: artifacts > 3 ? "error" : "warning" });
    const visible = (chunk.content.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (compact.length >= 80 && visible / compact.length < .35) issues.push({ chunkIndex: chunk.chunkIndex, code: "LOW_TEXT_DENSITY", severity: "warning" });
  }
  return { checkedChunkCount: chunks.length, issueCount: issues.length, issues };
}
