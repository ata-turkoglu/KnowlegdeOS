import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createDatabaseClient } from '@knowledgeos/database';
import { loadConfig } from '../../src/config/env.js';
import { replaceDocumentEntities, replaceDocumentRelationships } from '../../src/services/entities.js';
import { ensureWorkspaceStorage } from '../../src/services/storage.js';

function testUrl(t: TestContext) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { t.skip('TEST_DATABASE_URL is absent; no database was touched.'); return null; }
  if (!new URL(url).pathname.replace(/^\//, '').endsWith('_test')) throw new Error('Integration tests refuse databases whose name does not end in _test.');
  return url;
}

test('grounded aliases and relationships persist their provenance', async (t) => {
  const url = testUrl(t);
  if (!url) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledgeos-graph-'));
  const slug = `graph-${Date.now().toString(36)}`;
  const client = createDatabaseClient(url);
  try {
    const paths = await ensureWorkspaceStorage(root, slug);
    const markdownPath = path.join(paths.markdown, 'fixture.md');
    const content = 'Ali Veli (A. Veli), Acme Foundation temsil eder.';
    await writeFile(markdownPath, content);
    const [workspace] = await client.queryClient<{ id: string }[]>`insert into workspaces (slug, name, storage_path) values (${slug}, ${slug}, ${paths.root}) returning id`;
    const [document] = await client.queryClient<{ id: string }[]>`
      insert into documents (workspace_id, filename, title, markdown_path, content, normalized_content, status, hash)
      values (${workspace.id}, 'fixture.md', 'Fixture', ${markdownPath}, ${content}, 'ali veli a veli acme foundation temsil eder', 'UPLOADED', 'fixture-hash') returning id`;
    await client.queryClient`
      insert into document_chunks (document_id, chunk_index, content, normalized_content, content_hash, token_count)
      values (${document.id}, 0, ${content}, 'ali veli a veli acme foundation temsil eder', ${createHash('sha256').update(content).digest('hex')}, 8)`;
    const config = { ...loadConfig(), databaseUrl: url, storageRoot: root };
    const extracted = [
      { type: 'PERSON', value: 'Ali Veli', normalizedValue: 'ali veli', evidenceSnippet: 'Ali Veli', confidence: 0.98, source: 'REGEX' as const },
      { type: 'ORGANIZATION', value: 'Acme Foundation', normalizedValue: 'acme foundation', evidenceSnippet: 'Acme Foundation', confidence: 0.98, source: 'REGEX' as const },
    ];
    const firstAliases = await replaceDocumentEntities(config, slug, document.id, extracted, [{ canonical: 'Ali Veli', alias: 'A. Veli', confidence: 0.8, source: 'LLM' }], { provider: 'openai', model: 'fixture-model' });
    if (firstAliases.acceptedCount !== 1) throw new Error(JSON.stringify(firstAliases));
    const relationship = await replaceDocumentRelationships(config, slug, document.id, [{ source: 'Ali Veli', relation: 'temsil eder', target: 'Acme Foundation', evidence: content }], { provider: 'openai', model: 'fixture-model' });
    assert.equal(relationship.acceptedCount, 1);
    const [alias] = await client.queryClient<{ document_id: string; provider: string; model: string }[]>`select document_id, provider, model from entity_aliases where alias = 'A. Veli'`;
    assert.deepEqual(alias, { document_id: document.id, provider: 'openai', model: 'fixture-model' });
    const [edge] = await client.queryClient<{ provider: string; model: string }[]>`select provider, model from relationships where document_id = ${document.id}`;
    assert.deepEqual(edge, { provider: 'openai', model: 'fixture-model' });
  } finally {
    await client.queryClient`delete from workspaces where slug = ${slug}`;
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
