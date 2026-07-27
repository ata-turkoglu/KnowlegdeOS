import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRetrievalCache, retrievalCacheKey } from "../../src/services/rag-cache.js";

test("retrieval cache invalidates only the requested workspace", () => {
  const cache = new InMemoryRetrievalCache<number>(60_000);
  const keyA = retrievalCacheKey({ workspaceId: "a", query: "q", indexVersion: "1", retrievalSettingsVersion: "1", providerModel: "m", metadataFilters: {} });
  const keyB = retrievalCacheKey({ workspaceId: "b", query: "q", indexVersion: "1", retrievalSettingsVersion: "1", providerModel: "m", metadataFilters: {} });
  cache.set(keyA, 1);
  cache.set(keyB, 2);
  cache.invalidateWorkspace("a");
  assert.equal(cache.get(keyA), undefined);
  assert.equal(cache.get(keyB), 2);
});

test("retrieval cache expires entries", async () => {
  const cache = new InMemoryRetrievalCache<number>(1);
  cache.set("key", 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cache.get("key"), undefined);
});
