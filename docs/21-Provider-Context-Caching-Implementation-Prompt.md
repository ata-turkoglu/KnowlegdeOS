# KnowledgeOS Provider Context Caching Implementation Prompt

Implement provider-aware context caching for KnowledgeOS chat. Work directly in the repository, preserve the dirty worktree and existing behavior, avoid unrelated edits, and do not delete user data. Implement, test, and document the changes; do not stop at analysis.

The primary goal is to reduce paid API input-token cost during chat when a stable prompt prefix is reused. The secondary goal is lower time-to-first-token. Existing RAG retrieval caching is a separate layer and must remain intact.

## Current state

Inspect at least:

- `packages/ai/src/index.ts`
- `packages/ai/src/providers/anthropic.ts`
- `packages/ai/src/providers/openai.ts`
- `packages/ai/src/providers/gemini.ts`
- `packages/ai/src/providers/ollama.ts`
- `apps/api/src/services/ai-providers.ts`
- `apps/api/src/services/chat.ts`
- `apps/api/src/services/workspace-chat-prompt.ts`
- `apps/api/src/services/rag-cache.ts`
- chat routes, streaming path, provider settings, and related tests

Relevant current behavior:

- The LLM contract accepts one flattened `prompt: string`.
- Anthropic uses the Messages API.
- OpenAI uses the Responses API.
- Ollama uses `/api/generate`.
- RAG retrieval has a process-local exact-query cache with TTL and workspace invalidation.
- Model capability discovery and GPU metrics have their own caches.

Do not confuse any of those application caches with provider prompt/context caching.

## Desired result

For chat generation, separate reusable prompt content from request-specific content:

```text
stable prefix
  system instructions
  workspace chat instructions
  stable response/citation rules

dynamic suffix
  retrieved evidence for this question
  current user question
  validation-retry instructions, when present
```

Preserve prompt semantics and citation behavior. Do not cache authorization decisions, secrets, API keys, user-specific data from another workspace, or mutable evidence under a stale cache identity.

Provider behavior:

- Anthropic: explicitly mark the stable prefix for prompt caching using the currently supported Messages API cache-control format.
- OpenAI: arrange a byte-for-byte stable prefix so the provider's automatic prompt caching can activate on supported models. Do not invent a manual cache-control field.
- Gemini: use only officially supported context-caching behavior if it fits the existing API and lifecycle safely. Otherwise preserve normal generation and report caching as unsupported.
- Ollama: there is no paid token cost to reduce. Preserve local generation and optionally improve repeated-chat latency with a documented `keep_alive` setting. Do not claim Anthropic/OpenAI-style billable cached-token savings for Ollama.

## 1. Extend the provider contract without breaking existing callers

Introduce a provider-neutral structured request while keeping the current string methods working:

```ts
export type GenerationInput =
  | string
  | {
      stablePrefix?: string;
      dynamicPrompt: string;
      cache?: {
        mode: "auto" | "off";
        namespace?: string;
      };
    };

export type GenerationUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type GenerationMetadata = {
  provider: "ollama" | "openai" | "gemini" | "anthropic";
  model: string;
  usage?: GenerationUsage;
  cacheStatus: "HIT" | "MISS" | "CREATED" | "UNSUPPORTED" | "DISABLED" | "UNKNOWN";
};
```

Choose the smallest clean API that exposes metadata without disrupting existing response and streaming contracts. Acceptable designs include a result-returning companion method or an optional usage callback. Do not change every caller merely for symmetry.

Requirements:

- Existing `generate(string, ...)`, streaming, and structured JSON generation must continue to work.
- Only chat needs structured cached input initially. Extraction/conversion prompts remain unchanged unless they have a genuinely stable reusable prefix.
- Flattened text produced by the structured input must retain clear delimiters and the same instruction ordering.
- Cache namespaces are diagnostic/invalidation identities only; never place them in provider-visible text unless necessary.
- Do not implement a second in-memory cache containing model answers.

## 2. Refactor chat prompt construction

Change the chat preparation path so it can return:

```ts
{
  stablePrefix: string;
  dynamicPrompt: string;
  // existing response, validation evidence, and token-budget fields
}
```

The stable prefix should contain only content that is identical across multiple requests for the same effective configuration. The dynamic suffix should contain all retrieved chunks, source labels, the current question, and any per-request filters.

Create a deterministic cache identity from non-secret values such as:

- workspace slug or immutable workspace ID
- effective workspace-prompt version/hash
- prompt-template version
- provider and model
- relevant response-policy version

Do not include the current query in this identity. Prefer a cryptographic hash for long prompt material. Never log the complete prompt as the identity.

When workspace chat settings, provider/model selection, or the stable prompt template changes, the next request must naturally use a different identity/prefix. Provider-side expiry can remain provider-managed; no destructive remote purge mechanism is required.

Token budgeting must count the full effective input, including both stable and dynamic portions. Cached tokens still consume context-window capacity even when they are billed differently.

Validation retry:

- Reuse the same stable prefix.
- Put validation errors and correction instructions in the dynamic suffix.
- Do not duplicate the full first prompt inside the retry request.

## 3. Anthropic explicit prompt caching

Use the official Anthropic Messages API request shape supported at implementation time. Verify the current official documentation before coding because beta headers, cache-control syntax, TTL options, minimum cacheable token counts, and usage response fields may change.

Implementation requirements:

- Represent the reusable prefix as an eligible content/system block and attach `cache_control` only to the correct stable boundary.
- Keep retrieved evidence and the current question after the cached boundary.
- Support both non-streaming and streaming requests.
- Parse standard usage plus cache-read/cache-creation token fields returned by the API.
- Map usage into provider-neutral metadata.
- A response without cache usage fields must still succeed with `cacheStatus: "UNKNOWN"`.
- If the stable prefix is too short or the selected model does not support caching, generation must still work normally.
- Do not add undocumented headers or fields.
- Never log the API key, complete prompt, document evidence, or raw provider response.

Avoid adding a per-request random value, timestamp, query text, or volatile whitespace before the cache boundary.

## 4. OpenAI automatic prompt caching

OpenAI prompt caching is provider-managed for supported models. Verify the current official Responses API documentation before coding.

Implementation requirements:

- Send stable instructions/content first and dynamic evidence/question afterward.
- Keep the stable prefix byte-for-byte deterministic.
- If the current API supports a cache-routing key such as `prompt_cache_key`, use it only according to current official documentation and derive it from the non-secret cache identity.
- Do not send Anthropic-style `cache_control`.
- Parse cached input-token details from the current Responses API usage object when present.
- Map usage into provider-neutral metadata.
- Unsupported models or absent usage details must not break chat.
- Preserve current reasoning-model compatibility, including omission of unsupported temperature fields.

Do not use response IDs, conversation state, or stored responses as a substitute for prompt caching unless explicitly required by the current architecture.

## 5. Gemini behavior

Inspect the current Gemini provider and official API documentation.

- If explicit cached-content resources are implemented, manage their lifecycle safely, scope them by provider/model/workspace/prompt hash, apply a bounded TTL, and recover transparently from expired/not-found cache resources.
- Do not create a remote cached-content object on every chat request.
- If the prefix is below provider eligibility thresholds or lifecycle management adds more risk than value, leave Gemini generation unchanged and return `UNSUPPORTED`.
- Do not silently retain sensitive document evidence in a provider cache. Only the approved stable prefix may be eligible.

This provider is optional for the first implementation. Anthropic and OpenAI are required.

## 6. Ollama latency optimization

Ollama has no API token charge, so this section is not a cost-saving feature.

- Add an optional, configurable `keep_alive` value to generation requests if not already present.
- Use a conservative default that preserves current local resource expectations.
- Allow disabling it.
- Do not advertise a provider cache hit unless Ollama returns a real cache signal that can be interpreted reliably.
- Report `UNSUPPORTED` or `UNKNOWN` for provider context-cache status.
- Keep the existing RAG retrieval cache active.

Do not build a custom KV-cache implementation in the application.

## 7. Configuration

Add server-side configuration with safe defaults. Exact names may follow repository conventions:

```text
LLM_CONTEXT_CACHE_ENABLED=true
LLM_CONTEXT_CACHE_LOG_USAGE=true
OLLAMA_KEEP_ALIVE=5m
```

Requirements:

- A global off switch must make all providers behave as before.
- Provider-specific unsupported behavior must degrade gracefully.
- API keys and secrets must never appear in settings responses or logs.
- Do not require Redis.
- Do not expose low-level provider cache controls in the UI unless there is a clear user need.

## 8. Observability

Add structured, privacy-safe telemetry for each generation:

```text
provider
model
operation (chat | validation_retry | extraction | conversion)
cache_status
input_tokens
cached_input_tokens
cache_creation_input_tokens
output_tokens
stable_prefix_hash
stable_prefix_estimated_tokens
dynamic_prompt_estimated_tokens
duration_ms
```

Constraints:

- Never log prompt text, evidence, user queries, document names, raw answers, or credentials.
- Token fields may be absent depending on provider.
- Logging/metrics failure must never fail generation.
- Make it possible to compare cache hit rate and cached-token ratio by provider/model.

If the project has no metrics backend, use its existing structured logger and keep the telemetry boundary ready for future aggregation. Do not introduce a large observability dependency solely for this task.

Useful derived measures:

```text
cache_hit_rate = cache hits / eligible chat generations
cached_input_ratio = cached input tokens / total input tokens
```

Do not calculate monetary savings from hard-coded prices. Provider pricing changes; token counts are the durable measurement.

## 9. Tests

Use mocked provider responses; tests must not spend real API tokens or require network access.

Provider contract tests:

- legacy string input still works
- structured input preserves stable-prefix-before-dynamic-suffix ordering
- cache disabled produces the pre-feature request shape
- cancellation and timeout behavior remain intact

Anthropic tests:

- correct cache boundary/request block
- dynamic evidence and question remain outside the cached prefix
- non-streaming cache creation usage
- cache hit usage
- streaming usage/event parsing
- missing usage fields
- unsupported/too-short prefix fallback
- authentication, rate-limit, server error, abort, and timeout regressions

OpenAI tests:

- deterministic stable prefix is first
- supported cache-routing key is stable when used
- query changes do not change the stable prefix/key
- workspace prompt or model changes do change the key
- cached-token usage parsing
- absent cached-token details
- no Anthropic-only fields are sent

Chat integration tests:

- two questions in the same workspace share the same stable prefix identity
- evidence and user question differ per request
- different workspaces cannot share a stable prefix identity accidentally
- workspace prompt change invalidates the identity
- provider/model change invalidates the identity
- token budget counts cached and uncached portions equally
- validation retry reuses the stable prefix without duplicating the original prompt
- existing citation validation and RAG retrieval-cache tests remain green

Ollama tests:

- configured `keep_alive` is sent
- disabling it omits or disables the field according to the API contract
- no false billable-token saving is reported

## 10. Documentation

Update the relevant architecture/AI documentation with:

- the difference between RAG retrieval cache and provider context cache
- which providers support explicit, automatic, or no context caching
- privacy and invalidation boundaries
- configuration variables
- how to verify cache hits from structured usage logs
- the fact that cached tokens still count against the model context window
- the fact that Ollama optimization targets latency, not API cost

Do not include API keys, real prompts, or sensitive archive content in examples.

## Acceptance criteria

The task is complete only when:

1. Anthropic chat requests mark a stable prefix with the officially supported cache-control mechanism.
2. OpenAI chat requests use a deterministic, reusable prefix and capture cached-token usage when returned.
3. Dynamic RAG evidence and the current user question are never placed in a stale cross-request cache block.
4. Workspace, stable-prompt, provider, and model changes produce a new cache identity.
5. Cached tokens are still included in context-window budgeting.
6. Cache usage is observable without logging sensitive content.
7. The feature can be disabled globally.
8. Ollama behavior is described accurately and optional `keep_alive` does not claim token-cost savings.
9. Existing RAG retrieval caching and invalidation continue to work.
10. Unit and integration tests pass without external network calls.
11. Typecheck and project build pass.

## Verification commands

Inspect repository scripts and use the actual equivalents, but at minimum run:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

If the root package does not expose one of these scripts, run the relevant filtered workspace command instead. Report:

- changed files
- provider behavior implemented
- tests and build/typecheck results
- any provider feature intentionally left unsupported
- sample redacted usage telemetry showing a miss/creation followed by a hit
- remaining risks or official-API assumptions

