import assert from "node:assert/strict";
import test from "node:test";
import { GeminiProvider } from "@knowledgeos/ai";

test("Gemini provider exposes opt-in raw model output without its transport body", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ people: ["Ali"] }) }] } }]
  }), { status: 200 });
  let raw = "";
  const result = await new GeminiProvider("secret", "gemini-test", .1).generateJsonObject<{ people: string[] }>("extract", undefined, undefined, {
    rawOutput: { enabled: true, onOutput: (output) => { raw = output.text; } }
  });
  assert.deepEqual(result, { people: ["Ali"] });
  assert.equal(raw, '{"people":["Ali"]}');
});
