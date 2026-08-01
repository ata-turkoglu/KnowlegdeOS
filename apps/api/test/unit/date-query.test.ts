import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeForSearch } from '@knowledgeos/ingestion';
import {
  extractDateSearchVariants,
  inferDateSearchMode,
} from '../../src/services/date-search.js';
import { buildExecutionPlan } from '../../src/services/execution-planner.js';
import { deterministicAnalysis } from '../../src/services/query-analyzer.js';

const dateField = {
  id: 'field-date',
  workspaceId: 'workspace',
  key: 'date',
  label: 'Date',
  valueType: 'DATE' as const,
  filterable: true,
  entityEnabled: false,
  searchable: true,
  aliases: ['document_date'],
};

test('event-date questions stay on the content retrieval pipeline', () => {
  const analysis = deterministicAnalysis(
    'What happened on 12.6.1964?',
    [dateField],
  );
  const plan = buildExecutionPlan(analysis, 20, {
    totalDocuments: 10,
    filteredDocuments: 10,
    semanticSearch: true,
  });

  assert.equal(analysis.dateSearchMode, 'CONTENT_DATE');
  assert.equal(analysis.intent, 'FIND');
  assert.equal(analysis.filters.some((filter) => filter.fieldKey === 'date'), false);
  assert.equal(plan.requiresLlmAnswer, true);
  assert.ok(plan.nodes.some((node) => node.op === 'LEXICAL_SEARCH'));
  assert.ok(plan.nodes.some((node) => node.op === 'SEMANTIC_SEARCH'));
  assert.equal(plan.nodes.some((node) => ['COUNT', 'EXISTS'].includes(node.op)), false);
});

test('document-date listing keeps the canonical metadata constraint', () => {
  const analysis = deterministicAnalysis(
    'List documents dated 12.6.1964.',
    [dateField],
  );

  assert.equal(analysis.dateSearchMode, 'DOCUMENT_DATE');
  assert.deepEqual(analysis.filters, [
    {
      fieldId: dateField.id,
      fieldKey: 'date',
      operator: 'EQ',
      value: '1964-06-12',
      source: 'RULE',
      confidence: 1,
      locked: true,
    },
  ]);
});

test('document-date counts preserve deterministic COUNT semantics', () => {
  const analysis = deterministicAnalysis(
    'How many documents are dated 12.6.1964?',
    [dateField],
  );
  const plan = buildExecutionPlan(analysis);

  assert.equal(analysis.dateSearchMode, 'DOCUMENT_DATE');
  assert.equal(analysis.intent, 'COUNT');
  assert.ok(plan.nodes.some((node) => node.op === 'COUNT'));
  assert.equal(plan.requiresLlmAnswer, false);
});

test('event existence questions retrieve content instead of returning metadata false', () => {
  const analysis = deterministicAnalysis(
    'Was there an event on 12.6.1964?',
    [dateField],
  );
  const plan = buildExecutionPlan(analysis, 20, { semanticSearch: true });

  assert.equal(analysis.dateSearchMode, 'CONTENT_DATE');
  assert.equal(analysis.intent, 'FIND');
  assert.equal(plan.requiresLlmAnswer, true);
  assert.ok(plan.nodes.some((node) => node.op === 'LEXICAL_SEARCH'));
  assert.equal(plan.nodes.some((node) => node.op === 'EXISTS'), false);
});

test('supported numeric, English, and Turkish date forms share one canonical date', () => {
  const queries = [
    'What happened on 12.6.1964?',
    'What happened on 12.06.1964?',
    'What happened on 12/6/1964?',
    'What happened on 1964-06-12?',
    'What happened on 12 June 1964?',
    'What happened on 12 Haziran 1964?',
  ];

  for (const query of queries) {
    const variants = extractDateSearchVariants(query);
    assert.equal(variants?.iso, '1964-06-12');
    assert.equal(variants?.normalizedNumeric, '12 6 1964');
    assert.equal(inferDateSearchMode(query), 'CONTENT_DATE');
    assert.ok(
      variants?.textualVariants
        .map(normalizeForSearch)
        .includes('12 6 1964'),
    );
  }
});
