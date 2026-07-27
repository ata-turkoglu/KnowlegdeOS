# KnowledgeOS Claude + Dynamic Context Follow-up Prompt

Apply this as a follow-up task after the main RAG upgrade prompt. Work directly in the repository, preserve the dirty worktree and completed RAG work, avoid unrelated edits, and do not delete user data. Implement and test the changes; do not stop at analysis.

## Scope

Add Anthropic Claude as a first-class LLM provider and replace provider-name-based context limits with active-model capability discovery and token-aware budgeting.

Inspect:

- `apps/api/src/services/ai-providers.ts`
- `apps/api/src/config/env.ts`
- existing Ollama/OpenAI/Gemini providers
- settings routes and `apps/web/app/settings-panel.tsx`
- the Context Builder and chat generation path created by the main RAG upgrade
- shared provider/model types and tests

## 1. Claude provider

Add provider type `"anthropic"` across config, shared types, API, provider factories, settings persistence, validation, and UI.

Environment:

```text
ANTHROPIC_API_KEY
ANTHROPIC_LLM_MODEL
ANTHROPIC_BASE_URL (optional; default to the official API)
```

Claude is an **LLM-only** provider. Do not expose Anthropic as an embedding provider.

Implement the existing `LLMProvider` contract:

- generation
- streaming
- structured JSON generation using the project's validated JSON boundary
- system prompt and message mapping
- text content-block extraction
- usage and stop-reason capture
- AbortSignal and timeout handling
- clear handling of 401/403, 429, and retryable 5xx responses

Never return or log the API key. Use the official SDK only if it materially improves correctness; otherwise follow the repository's existing `fetch` style. Do not invent unsupported Anthropic JSON or embedding features.

Mocked tests must cover:

- normal response
- streaming
- valid and invalid structured JSON
- cancellation and timeout
- authentication, rate-limit, and server errors
- masked settings save/load
- switching among Ollama, OpenAI, Gemini, and Anthropic

## 2. Provider-neutral model capabilities

Create:

```ts
type CapabilitySource = "PROVIDER" | "REGISTRY" | "OVERRIDE" | "FALLBACK";

type ModelCapabilities = {
  provider: "ollama" | "openai" | "gemini" | "anthropic";
  model: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  runtimeContextLimit?: number | null;
  supportsTokenCounting: boolean;
  source: CapabilitySource;
  discoveredAt: string;
  warning?: string;
};

interface ModelCapabilityProvider {
  listModels(signal?: AbortSignal): Promise<string[]>;
  discover(model: string, signal?: AbortSignal): Promise<Partial<ModelCapabilities>>;
  countInputTokens?(input: string, signal?: AbortSignal): Promise<number>;
}
```

Discovery policy:

- Ollama: inspect local model metadata and configured runtime context.
- Gemini: use provider metadata for input/output token limits when returned.
- OpenAI: model endpoints may lack context limits; complete them from a versioned local registry.
- Anthropic: discover available model IDs when supported, use the official token-counting capability for prompts, and use registry/override data for limits absent from live metadata.
- Never scrape documentation or derive limits from model-name guesses.
- Unknown models use a conservative fallback with a visible warning.
- Provider discovery failure must not block selection when a safe fallback exists.

Resolution:

```text
validated soft override
→ live provider metadata
→ versioned registry
→ conservative fallback
```

An override may lower the usable limit but may not exceed a known hard limit. For Ollama:

```text
effective hard limit = min(model maximum, runtime context)
```

Cache by provider + model. Refresh on model/provider change, settings save, cache expiry, or manual refresh. Do not call discovery on every chat request. Keep discovery server-side and store source, timestamp, and warning state.

## 3. Token-aware Context Budgeter

Replace fixed provider/character limits with:

```text
available source tokens =
  min(effective hard input limit, configured RAG soft limit)
  - system prompt tokens
  - user query tokens
  - conversation-history tokens
  - source-markup tokens
  - reserved output tokens
  - safety margin
```

Keep separate:

- hard input/context limit
- RAG soft input limit
- reserved output budget
- request `maxOutputTokens`

Use exact provider token counting when available. Otherwise use a documented conservative estimator suitable for Turkish OCR. Before generation, count the final prompt and remove the lowest-ranked sources or neighbor chunks until it fits.

Do not expand neighbors linearly for huge windows:

1. Add reranked primary chunks.
2. Add a neighbor only when it repairs local context.
3. Prefer strong primary evidence over weak neighbors.
4. Stop at the soft budget even when the hard limit is much larger.

Settings should show, without secrets:

- detected input/output limits
- runtime context where relevant
- RAG soft limit
- reserved output budget
- capability source
- last refresh time
- fallback/warning state
- manual refresh action

## 4. Observability

Add structured, non-sensitive fields:

- provider and model
- capability source
- hard/soft/available token budgets
- estimated or exact prompt tokens
- actual input/output usage when returned
- preflight trimming count
- capability discovery and generation duration

Do not log prompts, document content, or secrets.

## 5. Tests

No test may call the internet or require a real LLM. Add tests for:

- provider metadata normalization
- registry/fallback resolution
- override cannot exceed hard limit
- capability cache refresh/invalidation
- unknown models
- exact and estimated token counting
- small/medium/large-window budgets
- score- and budget-aware neighbor expansion
- final preflight trimming
- model switching immediately changes the budget
- provider failure fallback
- no context overflow for any provider
- Claude provider behavior listed above

## Verification

Run the repository's full verification command from the main RAG upgrade plus:

```text
corepack pnpm typecheck
corepack pnpm build
```

Do not claim completion unless:

1. Claude is selectable and passes generate/stream/JSON/error tests.
2. Anthropic secrets never leave the backend.
3. Claude is not offered as an embedding provider.
4. Model selection refreshes capabilities and changes the context budget.
5. Unknown/unavailable metadata uses a tested safe fallback.
6. Final preflight prevents context overflow.
7. Existing Ollama/OpenAI/Gemini behavior remains compatible.

In the final report, list changed files, settings, tests, capability sources, fallback behavior, commands run, disabled features, and any provider runtime that remains unverified.
