# Provider context caching

KnowledgeOS has two independent cache layers:

- The RAG retrieval cache stores workspace-scoped retrieval results for an exact query for a short TTL. Workspace mutations invalidate it.
- Provider context caching lets an LLM provider reuse the processed prefix of a generation request. It does not store model answers and does not replace retrieval.

Chat prompts are split at a privacy boundary. The stable prefix contains the assistant role, workspace chat instructions, and versioned citation/response rules. The dynamic suffix contains the current question, retrieved document evidence, source labels, filters reflected by retrieval, and validation-retry instructions. Cached tokens still consume model context-window capacity, so token budgeting always counts the flattened stable and dynamic input.

## Provider behavior

| Provider | Behavior | Cache status |
| --- | --- | --- |
| Anthropic | An explicit `cache_control: { type: "ephemeral" }` breakpoint is attached to the stable `system` text block. Evidence and the question remain in the user message after the breakpoint. | `CREATED`, `HIT`, `MISS`, or `UNKNOWN` from Messages API usage |
| OpenAI | The stable prefix is byte-for-byte deterministic and precedes the dynamic suffix. A deterministic `prompt_cache_key` improves routing; the Responses API manages caching automatically. No Anthropic fields are sent. | `HIT`/`MISS`, plus `CREATED` where `cache_write_tokens` is returned |
| Gemini | Generation is unchanged. Explicit cached-content lifecycle management is intentionally unsupported in this implementation because safe remote resource reuse and expiry recovery would add a second lifecycle. | `UNSUPPORTED` |
| Ollama | `keep_alive` can retain a loaded local model to reduce repeated-request latency. This is not a billable-token cache and does not imply API-cost savings. | `UNSUPPORTED` |

Anthropic and OpenAI enforce provider/model eligibility and minimum prompt lengths. A prefix below a provider threshold still generates normally; usage can report zero cached tokens or omit cache details.

## Identity and invalidation

The cache namespace is a SHA-256 identity derived from non-secret values:

- workspace slug
- hash of the effective workspace chat prompt
- chat template and response-policy versions
- provider and model

The user query and retrieved evidence are excluded from this identity and remain after the cache boundary. Changing the workspace, workspace prompt, provider, model, or versioned stable rules naturally creates a different identity. Provider expiry remains provider-managed; KnowledgeOS does not attempt remote destructive purges.

## Configuration

```text
LLM_CONTEXT_CACHE_ENABLED=true
LLM_CONTEXT_CACHE_LOG_USAGE=true
OLLAMA_KEEP_ALIVE=5m
```

Set `LLM_CONTEXT_CACHE_ENABLED=false` to omit provider cache controls and routing keys. Set `LLM_CONTEXT_CACHE_LOG_USAGE=false` to disable usage telemetry. Set `OLLAMA_KEEP_ALIVE=off` (also `false`, `0`, or `none`) to omit the Ollama request field.

## Privacy-safe telemetry

Each chat or validation-retry generation emits one JSON log record when usage logging is enabled. It contains provider/model, operation, status, token counts when supplied, stable-prefix hash, estimated stable/dynamic token counts, and duration. Prompt text, queries, evidence, document names, raw answers, credentials, and raw provider responses are never logged.

Redacted examples:

```json
{"event":"llm_generation","provider":"anthropic","model":"claude-example","operation":"chat","cache_status":"CREATED","input_tokens":42,"cached_input_tokens":0,"cache_creation_input_tokens":1200,"output_tokens":90,"stable_prefix_hash":"<sha256>","stable_prefix_estimated_tokens":1200,"dynamic_prompt_estimated_tokens":430,"duration_ms":1480}
{"event":"llm_generation","provider":"anthropic","model":"claude-example","operation":"chat","cache_status":"HIT","input_tokens":42,"cached_input_tokens":1200,"cache_creation_input_tokens":0,"output_tokens":84,"stable_prefix_hash":"<same-sha256>","stable_prefix_estimated_tokens":1200,"dynamic_prompt_estimated_tokens":390,"duration_ms":720}
```

Use `cache_status` to calculate hit rate by provider/model and `cached_input_tokens / input_tokens` (using the provider's total-input semantics) to compare cached-input ratios. Do not infer monetary savings from hard-coded prices.

## Current API assumptions

The implementation follows the provider documentation checked on 2026-07-27:

- Anthropic Messages prompt caching supports explicit content-block `cache_control` and reports `cache_read_input_tokens` and `cache_creation_input_tokens`.
- OpenAI Responses prompt caching uses exact prefixes, accepts `prompt_cache_key`, and reports reads in `usage.input_tokens_details.cached_tokens`; newer models can additionally report `cache_write_tokens`.

Provider fields are optional in parsing so missing usage details never fail generation.
