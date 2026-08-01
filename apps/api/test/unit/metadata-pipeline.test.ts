import assert from 'node:assert/strict';
import test from 'node:test';
import { collectMetadataCandidates, createMetadataDiagnostics, resolveMetadataCandidates, validateMetadataForSerialization } from '../../src/services/metadata-pipeline.js';
import { metadataFieldPolicies, metadataJsonSchema, metadataPromptFieldContract } from '@knowledgeos/shared';

const source = '# Sened\n21 Ağustos 1927\nDefter-i Hâkānî İdâresi sene 1329\nAli Bey\n';

test('metadata policy keeps scalar fields scalar and unions lists', () => {
  const diagnostics = createMetadataDiagnostics();
  collectMetadataCandidates({ date: '1927-08-21', date_text: ['21 Ağustos 1927', 'sene 1329'], issuer: ['Ali Bey', 'Başka kişi'], people: ['Ali Bey'] }, 0, diagnostics);
  collectMetadataCandidates({ date: '1927-08-21', date_text: '21 Ağustos 1927; sene 1329', issuer: 'Ali Bey', people: ['Ali Bey', 'Veli Bey'] }, 1, diagnostics);
  const metadata = resolveMetadataCandidates(diagnostics.candidates, source, diagnostics);
  assert.equal(metadata.date, '1927-08-21');
  assert.equal(metadata.date_text, '21 Ağustos 1927');
  assert.equal(metadata.issuer, 'Ali Bey');
  assert.deepEqual(metadata.people, ['Ali Bey']);
  assert.ok(diagnostics.issues.some((issue) => issue.includes('date_text returned as an array')));
});

test('metadata policy rejects system, unknown, and nested provider fields', () => {
  const diagnostics = createMetadataDiagnostics();
  collectMetadataCandidates({ document_code: 'forged', custom_value: 'x', title: { nested: true }, title2: 'x' }, 0, diagnostics);
  assert.equal(diagnostics.candidates.length, 0);
  assert.equal(diagnostics.issues.length, 4);
});

test('language is selected after all chunks and falls back only after aggregation', () => {
  const diagnostics = createMetadataDiagnostics();
  collectMetadataCandidates({ language: 'en' }, 0, diagnostics);
  collectMetadataCandidates({ language: 'en' }, 1, diagnostics);
  collectMetadataCandidates({ language: 'tr' }, 2, diagnostics);
  assert.equal(resolveMetadataCandidates(diagnostics.candidates, 'English archive record', diagnostics).language, 'en');
});

test('serialization gate rejects invalid built-in shapes', () => {
  assert.throws(() => validateMetadataForSerialization({ date_text: ['21 Ağustos 1927'] }), /scalar metadata field/);
  assert.throws(() => validateMetadataForSerialization({ people: 'Ali Bey' }), /list metadata field/);
});

test('registry has one policy per key and derives the prompt and schema contracts', () => {
  assert.equal(new Set(metadataFieldPolicies.map((policy) => policy.key)).size, metadataFieldPolicies.length);
  const schema = metadataJsonSchema() as { properties: Record<string, { type: string }> };
  assert.equal(schema.properties.date_text?.type, 'string');
  assert.equal(schema.properties.people?.type, 'array');
  assert.equal(Object.hasOwn(schema.properties, 'document_code'), false);
  assert.match(metadataPromptFieldContract(), /date_text/);
});
