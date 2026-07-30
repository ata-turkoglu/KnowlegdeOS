export type SmallModelMetricRole = "queryNormalizer" | "queryAnalyzer" | "ocrCorrector" | "conversationSummary" | "evidencePreparer" | "contradictionDetector" | "entityLinker" | "reranker" | "fieldMatcher";
export type SmallModelMetric = {
  attempts: number;
  successes: number;
  fallbacks: number;
  accepted: number;
};

const metrics: Record<SmallModelMetricRole, SmallModelMetric> = {
  queryNormalizer: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  queryAnalyzer: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  ocrCorrector: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  conversationSummary: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  evidencePreparer: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  contradictionDetector: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  entityLinker: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  reranker: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 },
  fieldMatcher: { attempts: 0, successes: 0, fallbacks: 0, accepted: 0 }
};

export function recordSmallModelMetric(
  role: SmallModelMetricRole,
  event: "attempt" | "success" | "fallback" | "accepted",
  amount = 1
) {
  const key = event === "attempt" ? "attempts" : event === "success" ? "successes" : event === "fallback" ? "fallbacks" : "accepted";
  metrics[role][key] += amount;
}

export function getSmallModelMetrics() {
  return structuredClone(metrics);
}
