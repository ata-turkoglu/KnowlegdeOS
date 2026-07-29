export type SmallModelMetricRole = "entityLinker" | "reranker" | "fieldMatcher";
export type SmallModelMetric = {
  attempts: number;
  successes: number;
  fallbacks: number;
  accepted: number;
};

const metrics: Record<SmallModelMetricRole, SmallModelMetric> = {
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
