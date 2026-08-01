# AI Package Context

## Purpose

Provider-neutral LLM/embedding contracts, prompts, and concrete provider adapters.

## Responsibilities

- Define generation, JSON, embedding, token-count, and context-caching interfaces.
- Implement Ollama, OpenAI, Gemini, and Anthropic adapters.
- Provide reusable prompt helpers and AI-domain types.

## Out of Scope

- Runtime role/model selection and credentials (`apps/api`).
- Retrieval, workspace data, HTTP routes, and answer-delivery policy.

## Architecture

`src/index.ts` owns public contracts; `src/providers/*` implements them; `src/prompts.ts` holds reusable prompt text/helpers.

## Dependencies

- Internal: none.
- External: platform `fetch` and TypeScript/Node runtime types.
- Consumes from: provider HTTP APIs at runtime.
- Provides to: API provider resolution and services.
- Must never depend on: database, ingestion, search, shared, or apps.

## Public APIs

- Provider interfaces and provider classes exported from `src/index.ts`.
- Prompt/type exports used by ingestion and chat orchestration.

## Entry Points

- `src/index.ts`.

## Key Files

1. `src/index.ts`
2. Matching `src/providers/*.ts`
3. `src/prompts.ts`
4. Provider unit tests under `apps/api/test/unit`

## Common Tasks

- Add provider: implement the common contracts and export it.
- Add provider capability: update interface, every adapter, API resolver, and tests.
- Change prompt helper: verify all API consumers and safety boundaries.
- Change caching: inspect provider caching documentation and tests.

## Important Constraints

- Do not log secrets, full private prompts, or raw document context.
- Respect abort signals, HTTP errors, JSON validation, and token limits.
- Keep adapters behaviorally aligned behind shared interfaces.
- Provider-specific options must not leak into unrelated application code.

## Related Modules

- Runtime model roles -> `../../apps/api/src/services/AI_CONTEXT.md`.
- Provider caching docs -> `../../docs/provider-context-caching.md`.
- Repository package rules -> `../AI_CONTEXT.md`.

