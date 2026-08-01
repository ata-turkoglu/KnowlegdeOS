import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIProvider, type GenerationMetadata } from "@knowledgeos/ai";

test("OpenAI legacy string input preserves the pre-cache request shape", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.input, "legacy prompt");
    assert.equal(body.prompt_cache_key, undefined);
    assert.equal(body.cache_control, undefined);
    return new Response(JSON.stringify({ output_text: "ok" }), { status: 200 });
  };
  let raw = "";
  assert.equal(await new OpenAIProvider("secret", "gpt-test", .2).generate("legacy prompt", undefined, { rawOutput: { enabled: true, onOutput: (output) => { raw = output.text; } } }), "ok");
  assert.equal(raw, "ok");
});

test("OpenAI sends a deterministic stable prefix first and parses cached usage", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const bodies: Array<Record<string, unknown>> = [];
  let metadata: GenerationMetadata | undefined;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      output_text: "ok",
      usage: { input_tokens: 1500, output_tokens: 30, input_tokens_details: { cached_tokens: 1024 } }
    }), { status: 200 });
  };
  const provider = new OpenAIProvider("secret", "gpt-test", .2);
  for (const question of ["question one", "question two"]) {
    await provider.generate({
      stablePrefix: "stable rules",
      dynamicPrompt: question,
      cache: { mode: "auto", namespace: "same-cache-key" }
    }, undefined, { onMetadata: (value) => { metadata = value; } });
  }
  assert.equal(bodies[0]?.prompt_cache_key, "same-cache-key");
  assert.equal(bodies[1]?.prompt_cache_key, "same-cache-key");
  assert.match(String(bodies[0]?.input), /^stable rules/);
  assert.match(String(bodies[1]?.input), /^stable rules/);
  assert.notEqual(bodies[0]?.input, bodies[1]?.input);
  assert.equal(bodies[0]?.cache_control, undefined);
  assert.equal(metadata?.cacheStatus, "HIT");
  assert.equal(metadata?.usage?.cachedInputTokens, 1024);
});

test("OpenAI cache off omits the cache routing key", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.prompt_cache_key, undefined);
    return new Response(JSON.stringify({ output_text: "ok", usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });
  };
  let metadata: GenerationMetadata | undefined;
  await new OpenAIProvider("secret", "gpt-test", .2).generate({
    stablePrefix: "stable",
    dynamicPrompt: "dynamic",
    cache: { mode: "off", namespace: "must-not-be-sent" }
  }, undefined, { onMetadata: (value) => { metadata = value; } });
  assert.equal(metadata?.cacheStatus, "DISABLED");
});

test("OpenAI absent cached-token details does not break cached input", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    output_text: "ok",
    usage: { input_tokens: 10, output_tokens: 2 }
  }), { status: 200 });
  let metadata: GenerationMetadata | undefined;
  const answer = await new OpenAIProvider("secret", "gpt-test", .2).generate({
    stablePrefix: "stable",
    dynamicPrompt: "dynamic",
    cache: { mode: "auto", namespace: "stable-key" }
  }, undefined, { onMetadata: (value) => { metadata = value; } });
  assert.equal(answer, "ok");
  assert.equal(metadata?.cacheStatus, "UNKNOWN");
});

test("OpenAI metadata JSON reserves enough output tokens for complete entity lists", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.max_output_tokens, 16_384);
    return new Response(JSON.stringify({ output_text: "{\"people\":[\"Ali\"]}" }), { status: 200 });
  };
  assert.deepEqual(await new OpenAIProvider("secret", "gpt-5-mini", .1).generateJsonObject("extract"), { people: ["Ali"] });
});
