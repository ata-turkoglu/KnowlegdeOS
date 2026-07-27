import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicProvider, type GenerationMetadata } from "@knowledgeos/ai";

test("Anthropic provider sends Messages API shape and parses text", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://anthropic.test/v1/messages");
    const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number; stream: boolean; messages: unknown[] };
    assert.deepEqual({ model: body.model, maxTokens: body.max_tokens, stream: body.stream }, { model: "claude-test", maxTokens: 777, stream: false });
    assert.equal(body.messages.length, 1);
    return new Response(JSON.stringify({ content: [{ type: "text", text: "grounded" }] }), { status: 200 });
  };
  const provider = new AnthropicProvider("secret", "claude-test", .2, "https://anthropic.test");
  assert.equal(await provider.generate("prompt", undefined, { maxOutputTokens: 777 }), "grounded");
});

test("Anthropic marks only the stable system block for prompt caching", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let metadata: GenerationMetadata | undefined;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      system: Array<{ type: string; text: string; cache_control: { type: string } }>;
      messages: Array<{ content: string }>;
    };
    assert.deepEqual(body.system, [{ type: "text", text: "stable rules", cache_control: { type: "ephemeral" } }]);
    assert.equal(body.messages[0]?.content, "evidence and current question");
    assert.doesNotMatch(JSON.stringify(body.system), /current question/);
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "grounded" }],
      usage: { input_tokens: 12, output_tokens: 4, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 }
    }), { status: 200 });
  };
  const provider = new AnthropicProvider("secret", "claude-test", .2, "https://anthropic.test");
  await provider.generate({
    stablePrefix: "stable rules",
    dynamicPrompt: "evidence and current question",
    cache: { mode: "auto", namespace: "diagnostic-only" }
  }, undefined, { onMetadata: (value) => { metadata = value; } });
  assert.equal(metadata?.cacheStatus, "CREATED");
  assert.equal(metadata?.usage?.cacheCreationInputTokens, 100);
});

test("Anthropic cache-off structured input uses the legacy message shape", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { system?: unknown; messages: Array<{ content: string }> };
    assert.equal(body.system, undefined);
    assert.match(body.messages[0]?.content ?? "", /^stable rules/);
    assert.match(body.messages[0]?.content ?? "", /dynamic_request/);
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
  };
  await new AnthropicProvider("secret", "claude-test", .2, "https://anthropic.test").generate({
    stablePrefix: "stable rules",
    dynamicPrompt: "question",
    cache: { mode: "off" }
  });
});

test("Anthropic missing cache usage remains successful and reports UNKNOWN", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
  let metadata: GenerationMetadata | undefined;
  const answer = await new AnthropicProvider("secret", "claude-test", .2).generate({
    stablePrefix: "short but valid input",
    dynamicPrompt: "question",
    cache: { mode: "auto" }
  }, undefined, { onMetadata: (value) => { metadata = value; } });
  assert.equal(answer, "ok");
  assert.equal(metadata?.cacheStatus, "UNKNOWN");
});

test("Anthropic provider streams SSE deltas", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const encoder = new TextEncoder();
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Mer"}}\n'));
      controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"ter"}}\n'));
      controller.close();
    }
  }), { status: 200 });
  const chunks: string[] = [];
  for await (const chunk of new AnthropicProvider("secret", "claude-test", .2, "https://anthropic.test").generateStream("prompt")) chunks.push(chunk);
  assert.deepEqual(chunks, ["Mer", "ter"]);
});

test("Anthropic streaming reports cache-hit usage", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const encoder = new TextEncoder();
  let metadata: GenerationMetadata | undefined;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":90,"cache_creation_input_tokens":0}}}\n'));
      controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"ok"}}\n'));
      controller.enqueue(encoder.encode('data: {"type":"message_delta","usage":{"output_tokens":3}}\n'));
      controller.close();
    }
  }), { status: 200 });
  const provider = new AnthropicProvider("secret", "claude-test", .2, "https://anthropic.test");
  for await (const _chunk of provider.generateStream({
    stablePrefix: "stable",
    dynamicPrompt: "dynamic",
    cache: { mode: "auto" }
  }, undefined, { onMetadata: (value) => { metadata = value; } })) {
    // Consume the stream so final usage is reported.
  }
  assert.equal(metadata?.cacheStatus, "HIT");
  assert.deepEqual(metadata?.usage, {
    inputTokens: 2,
    outputTokens: 3,
    cachedInputTokens: 90,
    cacheCreationInputTokens: 0
  });
});

test("Anthropic provider classifies authentication errors without leaking the key", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("denied", { status: 401 });
  await assert.rejects(new AnthropicProvider("super-secret", "claude-test", .2).generate("prompt"), (error: Error) => {
    assert.match(error.message, /authentication error \(401\)/);
    assert.doesNotMatch(error.message, /super-secret/);
    return true;
  });
});
