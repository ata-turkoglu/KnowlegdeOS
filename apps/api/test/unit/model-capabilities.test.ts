import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "../../src/config/env.js";
import { contextBudgetFromCount, countInputTokens, invalidateCapabilities, resolveModelCapabilities } from "../../src/services/model-capabilities.js";

function config(overrides: Partial<ApiConfig>): ApiConfig {
  return {
    databaseUrl: "", ollamaBaseUrl: "http://ollama", ollamaLlmModel: "qwen", ollamaLlmTimeoutMs: 0, ollamaKeepAlive: "5m", ollamaEmbeddingTimeoutMs: 0,
    llmTemperature: .2, llmTemperatures: { extraction: .1, answer: .3, summary: .3, creative: .7 }, ollamaEmbeddingModel: "bge",
    llmProvider: "ollama", embeddingProvider: "ollama", openaiApiKey: "", openaiLlmModel: "gpt-4.1-mini", openaiEmbeddingModel: "",
    geminiApiKey: "", geminiLlmModel: "gemini-2.5-flash", geminiEmbeddingModel: "", anthropicApiKey: "", anthropicLlmModel: "claude-sonnet-4-20250514",
    anthropicBaseUrl: "https://api.anthropic.test", llmContextCacheEnabled: true, llmContextCacheLogUsage: false, ragSoftInputTokens: 0, ragReservedOutputTokens: 1024,
    storageRoot: "", conversionRoot: "", apiHost: "", apiPort: 0, environmentPath: "", ...overrides
  };
}

test("Ollama discovery respects the smaller runtime context", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; invalidateCapabilities(); });
  globalThis.fetch = async () => new Response(JSON.stringify({ model_info: { "qwen.context_length": 32_768 }, parameters: "num_ctx 8192" }), { status: 200 });
  const result = await resolveModelCapabilities(config({}), true);
  assert.equal(result.inputTokenLimit, 8192);
  assert.equal(result.runtimeContextLimit, 8192);
  assert.equal(result.source, "PROVIDER");
});

test("Anthropic token counting uses the provider endpoint", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /count_tokens$/);
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "secret");
    return new Response(JSON.stringify({ input_tokens: 321 }), { status: 200 });
  };
  assert.deepEqual(await countInputTokens(config({ llmProvider: "anthropic", anthropicApiKey: "secret" }), "hello"), { tokens: 321, source: "PROVIDER" });
});

test("context budget is capped by hard model and output limits", () => {
  const budget = contextBudgetFromCount({
    provider: "ollama", model: "small", inputTokenLimit: 8_000, outputTokenLimit: 512,
    supportsTokenCounting: false, source: "PROVIDER", discoveredAt: new Date(0).toISOString()
  }, 1_000, 2_000, 12_000);
  assert.equal(budget.softInputTokens, 8_000);
  assert.equal(budget.reservedOutputTokens, 512);
  assert.ok(budget.availableSourceTokens > 0);
  assert.ok(budget.fixedPromptTokens + budget.availableSourceTokens + budget.reservedOutputTokens + budget.safetyMarginTokens <= budget.softInputTokens);
});
