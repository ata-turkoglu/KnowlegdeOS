import type { ApiConfig } from "../config/env.js";

export type CapabilitySource = "PROVIDER" | "REGISTRY" | "OVERRIDE" | "FALLBACK";
export type ModelCapabilities = {
  provider: ApiConfig["llmProvider"];
  model: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  runtimeContextLimit?: number | null;
  supportsTokenCounting: boolean;
  source: CapabilitySource;
  discoveredAt: string;
  warning?: string;
};
export interface ModelCapabilityProvider {
  listModels(signal?: AbortSignal): Promise<string[]>;
  discover(model: string, signal?: AbortSignal): Promise<Partial<ModelCapabilities>>;
  countInputTokens?(input: string, signal?: AbortSignal): Promise<number>;
}
export type ContextBudget = {
  hardInputTokens: number;
  softInputTokens: number;
  reservedOutputTokens: number;
  fixedPromptTokens: number;
  safetyMarginTokens: number;
  availableSourceTokens: number;
  tokenCountSource: "PROVIDER" | "ESTIMATE";
};

// Keep this explicit and versioned. Unknown models use a conservative fallback.
const registry: Record<string, { input: number; output: number }> = {
  "openai/gpt-4.1": { input: 1_000_000, output: 32_768 },
  "openai/gpt-4.1-mini": { input: 1_000_000, output: 32_768 },
  "gemini/gemini-2.5-flash": { input: 1_000_000, output: 65_536 },
  "gemini/gemini-2.5-pro": { input: 1_000_000, output: 65_536 },
  "anthropic/claude-sonnet-4-20250514": { input: 200_000, output: 64_000 },
  "anthropic/claude-opus-4-20250514": { input: 200_000, output: 32_000 }
};
const cache = new Map<string, { value: ModelCapabilities; expires: number }>();
const fallback = { input: 16_000, output: 1_024 };
const cacheTtlMs = 10 * 60_000;

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3); // deliberately conservative for Turkish OCR
}
export function invalidateCapabilities() {
  cache.clear();
}
export function selectedLlmModel(config: ApiConfig) {
  return config.llmProvider === "ollama" ? config.ollamaLlmModel
    : config.llmProvider === "openai" ? config.openaiLlmModel
      : config.llmProvider === "gemini" ? config.geminiLlmModel
        : config.anthropicLlmModel;
}
export function automaticSoftLimit(hardInputTokens: number) {
  if (hardInputTokens <= 16_000) return Math.max(4_000, hardInputTokens - 2_000);
  if (hardInputTokens <= 32_000) return 16_000;
  if (hardInputTokens <= 128_000) return 32_000;
  return 64_000;
}

export async function resolveModelCapabilities(config: ApiConfig, refresh = false, signal?: AbortSignal): Promise<ModelCapabilities> {
  const provider = config.llmProvider;
  const model = selectedLlmModel(config);
  const key = `${provider}:${model}`;
  const known = cache.get(key);
  if (!refresh && known && known.expires > Date.now()) return known.value;

  const registered = registry[`${provider}/${model}`];
  let value: ModelCapabilities = registered
    ? { provider, model, inputTokenLimit: registered.input, outputTokenLimit: registered.output, supportsTokenCounting: provider === "anthropic" || provider === "gemini", source: "REGISTRY", discoveredAt: new Date().toISOString() }
    : { provider, model, inputTokenLimit: fallback.input, outputTokenLimit: fallback.output, supportsTokenCounting: false, source: "FALLBACK", discoveredAt: new Date().toISOString(), warning: "Model limits are unavailable; using a conservative 16k-token fallback." };

  try {
    if (provider === "ollama") {
      const response = await fetch(`${config.ollamaBaseUrl.replace(/\/$/, "")}/api/show`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: model }), signal
      });
      if (!response.ok) throw new Error(`Ollama metadata failed with ${response.status}.`);
      const body = await response.json() as { model_info?: Record<string, number>; parameters?: string };
      const maximum = Object.entries(body.model_info ?? {}).find(([name]) => name.endsWith("context_length"))?.[1];
      const runtimeText = /(?:^|\n)num_ctx\s+(\d+)/.exec(body.parameters ?? "")?.[1];
      const runtime = runtimeText ? Number(runtimeText) : null;
      const hard = Math.min(maximum ?? value.inputTokenLimit ?? fallback.input, runtime ?? Number.MAX_SAFE_INTEGER);
      value = { ...value, inputTokenLimit: hard, runtimeContextLimit: runtime, supportsTokenCounting: false, source: "PROVIDER", warning: undefined };
    } else if (provider === "gemini" && config.geminiApiKey) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(config.geminiApiKey)}`, { signal });
      if (!response.ok) throw new Error(`Gemini metadata failed with ${response.status}.`);
      const body = await response.json() as { inputTokenLimit?: number; outputTokenLimit?: number };
      if (body.inputTokenLimit) value = { ...value, inputTokenLimit: body.inputTokenLimit, outputTokenLimit: body.outputTokenLimit ?? value.outputTokenLimit, supportsTokenCounting: true, source: "PROVIDER", warning: undefined };
    } else if (provider === "anthropic" && config.anthropicApiKey) {
      const response = await fetch(`${config.anthropicBaseUrl.replace(/\/$/, "")}/v1/models/${encodeURIComponent(model)}`, {
        headers: { "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" }, signal
      });
      if (!response.ok) throw new Error(`Anthropic metadata failed with ${response.status}.`);
      // Anthropic model metadata confirms availability but may not expose limits.
      value = { ...value, supportsTokenCounting: true, warning: registered ? undefined : value.warning };
    }
  } catch (error) {
    value = { ...value, warning: `${provider} metadata unavailable; ${value.source === "FALLBACK" ? "using conservative fallback." : "using registry limits."}` };
  }

  cache.set(key, { value, expires: Date.now() + cacheTtlMs });
  return value;
}

export async function countInputTokens(config: ApiConfig, input: string, signal?: AbortSignal): Promise<{ tokens: number; source: "PROVIDER" | "ESTIMATE" }> {
  const model = selectedLlmModel(config);
  try {
    if (config.llmProvider === "anthropic" && config.anthropicApiKey) {
      const response = await fetch(`${config.anthropicBaseUrl.replace(/\/$/, "")}/v1/messages/count_tokens`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: input }] }),
        signal
      });
      if (!response.ok) throw new Error(`Anthropic token count failed with ${response.status}.`);
      const body = await response.json() as { input_tokens?: number };
      if (Number.isFinite(body.input_tokens)) return { tokens: Number(body.input_tokens), source: "PROVIDER" };
    }
    if (config.llmProvider === "gemini" && config.geminiApiKey) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens?key=${encodeURIComponent(config.geminiApiKey)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: input }] }] }), signal
      });
      if (!response.ok) throw new Error(`Gemini token count failed with ${response.status}.`);
      const body = await response.json() as { totalTokens?: number };
      if (Number.isFinite(body.totalTokens)) return { tokens: Number(body.totalTokens), source: "PROVIDER" };
    }
  } catch {
    // Counting is an optimization. A conservative estimate is the safe fallback.
  }
  return { tokens: estimateTokens(input), source: "ESTIMATE" };
}

export function contextBudgetFromCount(
  capabilities: ModelCapabilities,
  fixedPromptTokens: number,
  reservedOutputTokens: number,
  configuredSoftLimit = 0,
  tokenCountSource: ContextBudget["tokenCountSource"] = "ESTIMATE"
): ContextBudget {
  const hard = capabilities.inputTokenLimit ?? fallback.input;
  const automatic = automaticSoftLimit(hard);
  const requestedSoft = configuredSoftLimit > 0 ? configuredSoftLimit : automatic;
  const soft = Math.min(hard, requestedSoft);
  const output = Math.min(Math.max(256, reservedOutputTokens), capabilities.outputTokenLimit ?? reservedOutputTokens);
  const safety = Math.max(256, Math.ceil(soft * 0.02));
  return {
    hardInputTokens: hard,
    softInputTokens: soft,
    reservedOutputTokens: output,
    fixedPromptTokens,
    safetyMarginTokens: safety,
    availableSourceTokens: Math.max(0, soft - fixedPromptTokens - output - safety),
    tokenCountSource
  };
}

export async function sourceBudget(config: ApiConfig, capabilities: ModelCapabilities, promptWithoutSources: string, reservedOutputTokens: number, signal?: AbortSignal) {
  const count = await countInputTokens(config, promptWithoutSources, signal);
  return contextBudgetFromCount(capabilities, count.tokens, reservedOutputTokens, config.ragSoftInputTokens, count.source);
}
