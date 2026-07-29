import assert from "node:assert/strict";
import test from "node:test";
import { orderChatMessages, type StoredChatMessage } from "../../src/services/chat-history.js";

function message(id: string, role: StoredChatMessage["role"], createdAt: string): StoredChatMessage {
  return { id, role, content: id, createdAt, queryType: null, sources: [] };
}

test("chat history orders a same-timestamp question before its answer", () => {
  const timestamp = "2026-07-24T11:52:00.000Z";
  const ordered = orderChatMessages([
    message("assistant", "assistant", timestamp),
    message("user", "user", timestamp)
  ]);

  assert.deepEqual(ordered.map((item) => item.role), ["user", "assistant"]);
});

test("chat history keeps chronological exchanges in order", () => {
  const ordered = orderChatMessages([
    message("answer-two", "assistant", "2026-07-24T11:53:00.001Z"),
    message("question-one", "user", "2026-07-24T11:52:00.000Z"),
    message("answer-one", "assistant", "2026-07-24T11:52:00.001Z"),
    message("question-two", "user", "2026-07-24T11:53:00.000Z")
  ]);

  assert.deepEqual(ordered.map((item) => item.id), ["question-one", "answer-one", "question-two", "answer-two"]);
});
