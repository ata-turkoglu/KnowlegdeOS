import assert from "node:assert/strict";
import test from "node:test";
import { reportRawModelOutput } from "@knowledgeos/ai";

test("raw model output capture is opt-in, bounded, and redacts token-shaped values", () => {
  const received: unknown[] = [];
  reportRawModelOutput(undefined, "ollama", "qwen", "sk_abcdefghijklmnopqrstuvwxyz");
  assert.deepEqual(received, []);

  reportRawModelOutput({
    rawOutput: {
      enabled: true,
      maxCharacters: 24,
      onOutput: (value) => { received.push(value); }
    }
  }, "openai", "gpt-test", "answer api_key=super-secret-value sk_abcdefghijklmnopqrstuvwxyz");

  const output = received[0] as { provider: string; model: string; text: string; originalCharacterCount: number; truncated: boolean };
  assert.equal(output.provider, "openai");
  assert.equal(output.model, "gpt-test");
  assert.doesNotMatch(output.text, /super-secret|sk_abc/);
  assert.equal(output.originalCharacterCount > output.text.length, true);
  assert.equal(output.truncated, true);
});
