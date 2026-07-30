import type { HybridApiProvider } from "../config/env.js";
import type { ExecutionPlan } from "./execution-planner.js";
import type { RetrievalCandidate } from "./rag-core.js";

export type HybridRerankRoute = "skip" | "local" | "api";

export function decideHybridRerankRoute(input: {
  plan: ExecutionPlan;
  candidates: RetrievalCandidate[];
  hasNumericAnchors: boolean;
  apiProvider: HybridApiProvider;
  apiModel: string;
}) {
  if (!input.plan.nodes.some((node) => node.op === "RERANK")) return { route: "skip" as const, reason: "plan_skips_rerank" };
  if (input.hasNumericAnchors) return { route: "skip" as const, reason: "numeric_anchor" };
  if (input.apiProvider === "none" || !input.apiModel) return { route: "local" as const, reason: "api_not_configured" };

  const [first, second] = input.candidates;
  // Scores close to each other mean retrieval cannot confidently choose the
  // best evidence. Only then do we send a small, redacted candidate set to API.
  const scoreGap = first && second ? Math.abs(first.score - second.score) : 1;
  const multiRetrieverTop = Boolean(first?.retrievers && new Set(first.retrievers).size > 1);
  if (scoreGap < 0.08 || !multiRetrieverTop) return { route: "api" as const, reason: scoreGap < 0.08 ? "close_scores" : "single_retriever_top" };
  return { route: "local" as const, reason: "clear_retrieval_signal" };
}
