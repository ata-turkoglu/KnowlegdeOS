import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createDatabaseClient } from "@knowledgeos/database";
import { loadConfig } from "../../src/config/env.js";
import { HttpError } from "../../src/lib/http-errors.js";
import { storeUploadedDocument } from "../../src/services/documents.js";
import { ensureWorkspaceStorage } from "../../src/services/storage.js";

function testUrl(t: TestContext) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { t.skip("TEST_DATABASE_URL is absent; no database was touched."); return null; }
  if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) throw new Error("Integration tests refuse databases whose name does not end in _test.");
  return url;
}

test("an indexed filename conflict leaves its stored Markdown untouched", async (t) => {
  const url = testUrl(t);
  if (!url) return;
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledgeos-upload-"));
  const suffix = Date.now().toString(36);
  const slug = `upload-conflict-${suffix}`;
  const client = createDatabaseClient(url);
  try {
    const paths = await ensureWorkspaceStorage(root, slug);
    const storedPath = path.join(paths.markdown, "same.md");
    const incomingPath = path.join(root, "incoming.md");
    await writeFile(storedPath, "old indexed content");
    await writeFile(incomingPath, "new conflicting content");
    const [workspace] = await client.queryClient<{ id: string }[]>`insert into workspaces (slug, name, storage_path) values (${slug}, ${slug}, ${paths.root}) returning id`;
    await client.queryClient`
      insert into documents (workspace_id, filename, title, markdown_path, content, normalized_content, status, hash)
      values (${workspace.id}, 'same.md', 'Same', ${storedPath}, 'old indexed content', 'old indexed content', 'INDEXED', 'old-hash')`;
    const config = { ...loadConfig(), databaseUrl: url, storageRoot: root };

    await assert.rejects(
      storeUploadedDocument(config, { workspaceSlug: slug, markdownFile: { filename: "same.md", filepath: incomingPath } as any }),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409
    );
    assert.equal(await readFile(storedPath, "utf8"), "old indexed content");
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("replacing an unindexed upload resets stale derived index state", async (t) => {
  const url = testUrl(t);
  if (!url) return;
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledgeos-upload-"));
  const suffix = Date.now().toString(36);
  const slug = `upload-reset-${suffix}`;
  const client = createDatabaseClient(url);
  try {
    const paths = await ensureWorkspaceStorage(root, slug);
    const storedPath = path.join(paths.markdown, "draft.md");
    const incomingPath = path.join(root, "incoming.md");
    await writeFile(storedPath, "old draft");
    await writeFile(incomingPath, "---\ntitle: Yeni Taslak\n---\nyeni içerik");
    const [workspace] = await client.queryClient<{ id: string }[]>`insert into workspaces (slug, name, storage_path) values (${slug}, ${slug}, ${paths.root}) returning id`;
    const [document] = await client.queryClient<{ id: string }[]>`
      insert into documents (workspace_id, filename, title, markdown_path, content, normalized_content, status, hash, summary, embedding_model, indexed_at, llm_extraction, llm_extraction_error)
      values (${workspace.id}, 'draft.md', 'Old', ${storedPath}, 'old draft', 'old draft', 'UPLOADED', 'old-hash', 'old summary', 'ollama/bge-m3', now(), '{"people":[]}'::jsonb, 'old error') returning id`;
    await client.queryClient`insert into document_chunks (document_id, chunk_index, content, normalized_content, content_hash, token_count) values (${document.id}, 0, 'stale', 'stale', encode(digest(convert_to('stale', 'UTF8'), 'sha256'), 'hex'), 1)`;
    const config = { ...loadConfig(), databaseUrl: url, storageRoot: root };

    await storeUploadedDocument(config, { workspaceSlug: slug, markdownFile: { filename: "draft.md", filepath: incomingPath } as any });
    const [row] = await client.queryClient<{ status: string; summary: string | null; embedding_model: string | null; indexed_at: Date | null; llm_extraction: unknown; llm_extraction_error: string | null; content: string; chunk_count: number }[]>`
      select d.status, d.summary, d.embedding_model, d.indexed_at, d.llm_extraction, d.llm_extraction_error, d.content, count(c.id)::int as chunk_count
      from documents d left join document_chunks c on c.document_id = d.id where d.id = ${document.id} group by d.id`;
    assert.equal(row.status, "UPLOADED");
    assert.equal(row.summary, null);
    assert.equal(row.embedding_model, null);
    assert.equal(row.indexed_at, null);
    assert.equal(row.llm_extraction, null);
    assert.equal(row.llm_extraction_error, null);
    assert.equal(row.content, "yeni içerik");
    assert.equal(row.chunk_count, 0);
    assert.equal(await readFile(storedPath, "utf8"), "---\ntitle: Yeni Taslak\n---\nyeni içerik");
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
