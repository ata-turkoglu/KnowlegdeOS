import type { ApiConfig } from '../config/env.js';

export const indexingStages = ['metadata', 'entities', 'aliases', 'relationships', 'claims', 'summary', 'embeddings'] as const;
export type IndexingStageName = (typeof indexingStages)[number];
export type IndexingExecutionMode = 'deterministic' | 'local_llm' | 'api_llm' | 'skip';
export type IndexingStageStatus = 'pending' | 'running' | 'succeeded' | 'succeeded_with_warnings' | 'failed' | 'skipped';
export type IndexingRequestMode = 'automatic' | 'user_configured';
export type IndexingStageDecision = {
  stage: IndexingStageName;
  required: boolean;
  execution: IndexingExecutionMode;
  provider?: string;
  model?: string;
  reason: string;
  requestedBy: 'user' | 'system' | 'policy' | 'fallback';
};
export type IndexingPlan = {
  version: 1;
  workspaceId?: string;
  documentId?: string;
  requestedMode: IndexingRequestMode;
  stages: Record<IndexingStageName, IndexingStageDecision>;
};
export type IndexingStageResult = {
  stage: IndexingStageName;
  status: IndexingStageStatus;
  execution: IndexingExecutionMode;
  provider?: string;
  model?: string;
  startedAt?: string;
  completedAt?: string;
  inputCandidateCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  rejectionCounts?: Record<string, number>;
  rejectionSamples?: Array<{ reason: string; candidate: Record<string, string> }>;
  warnings?: string[];
  error?: string;
};

function route(model: string) {
  const [prefix, ...parts] = model.split('/');
  if (parts.length && ['openai', 'gemini', 'anthropic'].includes(prefix)) return { provider: prefix, model: parts.join('/'), execution: 'api_llm' as const };
  return { provider: 'ollama', model, execution: 'local_llm' as const };
}

function skipped(stage: IndexingStageName, reason: string): IndexingStageDecision {
  return { stage, required: false, execution: 'skip', reason, requestedBy: 'policy' };
}

/** Resolves independent indexing capabilities. This deliberately does not accept
 * the former useLlm boolean: deterministic entity persistence is always planned. */
export function resolveIndexingPlan(config: ApiConfig, input: {
  mode?: IndexingRequestMode;
  workspaceId?: string;
  documentId?: string;
  hasFrontmatter?: boolean;
  chunkCount?: number;
  requestedStages?: Partial<Record<IndexingStageName, boolean>>;
} = {}): IndexingPlan {
  const requestedMode = input.mode ?? 'automatic';
  const wants = (stage: IndexingStageName, fallback: boolean) => input.requestedStages?.[stage] ?? fallback;
  const primary = route(config.llmProvider === 'ollama' ? config.ollamaLlmModel : config.llmProvider === 'openai' ? `openai/${config.openaiLlmModel}` : config.llmProvider === 'gemini' ? `gemini/${config.geminiLlmModel}` : `anthropic/${config.anthropicLlmModel}`);
  const llm = (stage: IndexingStageName, selected: ReturnType<typeof route>, reason: string): IndexingStageDecision => ({ stage, required: true, execution: selected.execution, provider: selected.provider, model: selected.model, reason, requestedBy: requestedMode === 'user_configured' ? 'user' : 'system' });
  return {
    version: 1, workspaceId: input.workspaceId, documentId: input.documentId, requestedMode,
    stages: {
      metadata: input.hasFrontmatter ? { stage: 'metadata', required: true, execution: 'deterministic', reason: 'Validated YAML/frontmatter is ingested without another extraction call.', requestedBy: 'policy' } : skipped('metadata', 'No frontmatter is present; metadata generation is a separate conversion workflow.'),
      entities: { stage: 'entities', required: true, execution: 'deterministic', reason: 'Frontmatter and regex entities must persist independently of LLM availability.', requestedBy: 'policy' },
      aliases: wants('aliases', true) ? llm('aliases', primary, 'Enrich only after deterministic entity candidates are available.') : skipped('aliases', 'Not requested by indexing policy.'),
      relationships: wants('relationships', true) ? llm('relationships', primary, 'Evidence-backed graph edges require a routed LLM stage.') : skipped('relationships', 'Not requested by indexing policy.'),
      claims: wants('claims', true) ? llm('claims', primary, 'Evidence-backed claims are independent from relationships.') : skipped('claims', 'Not requested by indexing policy.'),
      summary: wants('summary', true) ? llm('summary', primary, 'Document summary is an optional generated stage.') : skipped('summary', 'Not requested by indexing policy.'),
      embeddings: { stage: 'embeddings', required: true, execution: 'deterministic', provider: config.embeddingProvider, model: config.embeddingProvider === 'ollama' ? config.ollamaEmbeddingModel : config.embeddingProvider === 'openai' ? config.openaiEmbeddingModel : config.geminiEmbeddingModel, reason: `Configured ${config.embeddingProvider} embedding route.`, requestedBy: 'policy' },
    },
  };
}

export function initialIndexingStageResults(plan: IndexingPlan): Record<IndexingStageName, IndexingStageResult> {
  return Object.fromEntries(indexingStages.map((stage) => {
    const decision = plan.stages[stage];
    return [stage, { stage, status: decision.execution === 'skip' ? 'skipped' : 'pending', execution: decision.execution, provider: decision.provider, model: decision.model }];
  })) as Record<IndexingStageName, IndexingStageResult>;
}
