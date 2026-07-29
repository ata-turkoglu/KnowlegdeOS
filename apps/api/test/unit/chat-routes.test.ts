import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { ApiConfig } from "../../src/config/env.js";
import { registerChatRoutes, type ChatRouteDependencies } from "../../src/routes/chat.js";
import type { ChatResponse } from "../../src/services/chat.js";

const config = {} as ApiConfig;
const sessionId = "11111111-1111-4111-8111-111111111111";
const response: ChatResponse = {
  queryType: "SEMANTIC_SEARCH",
  answer: "Doğrulanmış cevap [1]",
  matchedEntity: null,
  matchedAliases: [],
  sources: [{
    documentName: "belge.md",
    title: "Belge",
    evidenceSnippet: "Doğrulanmış cevap",
    sourceType: "SEMANTIC"
  }]
};

async function createApp(t: TestContext, overrides: Partial<ChatRouteDependencies> = {}, withCors = false) {
  const app = Fastify({ logger: false });
  if (withCors) {
    await app.register(cors, {
      origin: ["http://localhost:3000", "http://127.0.0.1:3000"]
    });
  }
  await registerChatRoutes(app, config, {
    answerChat: async (_config, input) => {
      await input.onProgress?.({ stage: "received" });
      return response;
    },
    saveChatExchange: async () => ({ sessionId }),
    ...overrides
  });
  await app.ready();
  t.after(() => app.close());
  return app;
}

test("chat route rejects malformed bodies before invoking the service", async (t) => {
  let invoked = false;
  const app = await createApp(t, {
    answerChat: async () => {
      invoked = true;
      return response;
    }
  });

  const invalidMessage = await app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { message: 42 }
  });
  const invalidLength = await app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { message: "Merhaba", answerLength: "unlimited" }
  });
  const unknownProperty = await app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { message: "Merhaba", unexpected: true }
  });

  assert.equal(invalidMessage.statusCode, 400);
  assert.equal(invalidLength.statusCode, 400);
  assert.equal(unknownProperty.statusCode, 400);
  assert.equal(invoked, false);
});

test("chat route trims messages and passes an abort signal for regular requests", async (t) => {
  let receivedMessage = "";
  let receivedSignal: AbortSignal | undefined;
  const app = await createApp(t, {
    answerChat: async (_config, input) => {
      receivedMessage = input.message;
      receivedSignal = input.signal;
      return response;
    }
  });

  const result = await app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { message: "  Merhaba  " }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(receivedMessage, "Merhaba");
  assert.ok(receivedSignal instanceof AbortSignal);
});

test("chat route maps internal, timeout, and upstream failures without leaking details", async (t) => {
  const cases = [
    { error: new Error("database password=super-secret"), statusCode: 500, message: "Sohbet isteği işlenemedi." },
    { error: Object.assign(new Error("provider timeout details"), { code: "ETIMEDOUT" }), statusCode: 504, message: "Model yanıtı zaman aşımına uğradı." },
    { error: Object.assign(new Error("socket details"), { code: "ECONNREFUSED" }), statusCode: 503, message: "Model servisine şu anda ulaşılamıyor." }
  ];

  for (const item of cases) {
    const app = await createApp(t, {
      answerChat: async () => { throw item.error; }
    });
    const result = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Merhaba" }
    });

    assert.equal(result.statusCode, item.statusCode);
    assert.deepEqual(result.json(), { error: item.message });
    assert.doesNotMatch(result.body, /super-secret|provider timeout details|socket details/);
  }
});

test("chat history route validates and forwards bounded pagination", async (t) => {
  let received: { workspaceSlug: string; limit: number; offset: number } | undefined;
  const app = await createApp(t, {
    listChatSessions: async (_config, workspaceSlug, pagination) => {
      received = { workspaceSlug, ...pagination };
      return { sessions: [], pagination: { ...pagination, hasMore: false } };
    }
  });

  const result = await app.inject({
    method: "GET",
    url: "/api/chat/sessions?workspaceSlug=proje-arsivi&limit=25&offset=50"
  });
  const oversized = await app.inject({
    method: "GET",
    url: "/api/chat/sessions?limit=101"
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(received, { workspaceSlug: "proje-arsivi", limit: 25, offset: 50 });
  assert.deepEqual(result.json(), {
    sessions: [],
    pagination: { limit: 25, offset: 50, hasMore: false }
  });
  assert.equal(oversized.statusCode, 400);
});

test("SSE response uses the shared CORS policy and emits a persisted result", async (t) => {
  const app = await createApp(t, {}, true);
  const allowed = await app.inject({
    method: "POST",
    url: "/api/chat",
    headers: { origin: "http://127.0.0.1:3000" },
    payload: { message: "Merhaba", stream: true }
  });
  const denied = await app.inject({
    method: "POST",
    url: "/api/chat",
    headers: { origin: "https://example.invalid" },
    payload: { message: "Merhaba", stream: true }
  });

  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], "http://127.0.0.1:3000");
  assert.match(allowed.headers["content-type"] ?? "", /^text\/event-stream/);
  assert.match(allowed.body, /Kaynaklar aranıyor ve yanıt hazırlanıyor/);
  assert.match(allowed.body, /Yanıt ve kullanılan kaynaklar kaydediliyor/);
  assert.match(allowed.body, /Yanıt gönderiliyor/);
  assert.match(allowed.body, /event: progress/);
  assert.match(allowed.body, /"stage":"received"/);
  assert.match(allowed.body, /"stage":"persist"/);
  assert.match(allowed.body, /"stage":"deliver"/);
  assert.match(allowed.body, /event: meta/);
  assert.match(allowed.body, /event: done/);
  assert.equal(denied.statusCode, 200);
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});
