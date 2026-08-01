import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { ApiConfig } from "../../src/config/env.js";
import { registerDocumentRoutes } from "../../src/routes/documents.js";
import { getWorkspaceStoragePaths } from "../../src/services/storage.js";

test("indexing diagnostics route returns only a valid retained workspace trace", async (t) => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "knowledgeos-trace-"));
  const workspaceSlug = "trace-fixture";
  const traceId = "11111111-1111-4111-8111-111111111111";
  const paths = getWorkspaceStoragePaths(storageRoot, workspaceSlug);
  await mkdir(paths.metadata, { recursive: true });
  await writeFile(path.join(paths.metadata, `indexing-trace-${traceId}.json`), '{"traceId":"11111111-1111-4111-8111-111111111111","schemaVersion":1}\n');

  const app = Fastify({ logger: false });
  await registerDocumentRoutes(app, { storageRoot } as ApiConfig);
  await app.ready();
  t.after(async () => { await app.close(); await rm(storageRoot, { recursive: true, force: true }); });

  const found = await app.inject({ method: "GET", url: `/api/indexing-diagnostics/${workspaceSlug}/${traceId}` });
  const invalid = await app.inject({ method: "GET", url: `/api/indexing-diagnostics/${workspaceSlug}/not-a-trace` });
  const missing = await app.inject({ method: "GET", url: `/api/indexing-diagnostics/${workspaceSlug}/22222222-2222-4222-8222-222222222222` });

  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { traceId, schemaVersion: 1 });
  assert.equal(invalid.statusCode, 400);
  assert.equal(missing.statusCode, 404);
});
