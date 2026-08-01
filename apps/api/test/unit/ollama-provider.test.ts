import assert from "node:assert/strict";
import test from "node:test";
import { OllamaProvider } from "@knowledgeos/ai";

test("Ollama generation keeps the caller signal and has no internal timeout signal", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  const encoder = new TextEncoder();
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    const body = JSON.parse(String(init?.body)) as { keep_alive?: string };
    assert.equal(body.keep_alive, "5m");
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(encoder.encode('{"response":"ok"}\n'));
        stream.close();
      }
    }), { status: 200 });
  };
  const provider = new OllamaProvider("http://ollama", "qwen3:8b", 1, .1);
  let raw = "";
  assert.equal(await provider.generate("prompt", controller.signal, { rawOutput: { enabled: true, onOutput: (output) => { raw = output.text; } } }), "ok");
  assert.equal(raw, "ok");
});

test("Ollama keep_alive can be disabled without reporting cost-cache savings", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const encoder = new TextEncoder();
  let cacheStatus = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { keep_alive?: string };
    assert.equal(body.keep_alive, undefined);
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(encoder.encode('{"response":"ok"}\n'));
        stream.close();
      }
    }), { status: 200 });
  };
  const provider = new OllamaProvider("http://ollama", "qwen3:8b", 0, .1, null);
  await provider.generate({
    stablePrefix: "stable",
    dynamicPrompt: "dynamic",
    cache: { mode: "auto" }
  }, undefined, { onMetadata: (metadata) => { cacheStatus = metadata.cacheStatus; } });
  assert.equal(cacheStatus, "UNSUPPORTED");
});
