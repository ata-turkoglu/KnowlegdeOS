import assert from 'node:assert/strict';
import test from 'node:test';
import { initialIndexingStageResults, resolveIndexingPlan } from '../../src/services/indexing-plan.js';

const config: any = {
  llmProvider: 'openai', openaiLlmModel: 'gpt-test', geminiLlmModel: 'gemini-test', anthropicLlmModel: 'claude-test', ollamaLlmModel: 'local-test',
  entityLinkerModel: 'local-linker', embeddingProvider: 'ollama', ollamaEmbeddingModel: 'embed-test', openaiEmbeddingModel: 'embed-openai', geminiEmbeddingModel: 'embed-gemini',
};

test('automatic indexing plans deterministic entities independently from graph stages', () => {
  const plan = resolveIndexingPlan(config, { hasFrontmatter: true, chunkCount: 2 });
  assert.equal(plan.stages.entities.execution, 'deterministic');
  assert.equal(plan.stages.aliases.execution, 'api_llm');
  assert.equal(plan.stages.aliases.provider, 'openai');
  assert.equal(plan.stages.relationships.execution, 'api_llm');
  assert.equal(plan.stages.relationships.provider, 'openai');
  assert.equal(initialIndexingStageResults(plan).entities.status, 'pending');
});

test('requested graph skips do not disable deterministic entity persistence', () => {
  const plan = resolveIndexingPlan(config, { requestedStages: { aliases: false, relationships: false, claims: false, summary: false } });
  assert.equal(plan.stages.entities.execution, 'deterministic');
  assert.equal(plan.stages.aliases.execution, 'skip');
  assert.equal(plan.stages.relationships.execution, 'skip');
});
