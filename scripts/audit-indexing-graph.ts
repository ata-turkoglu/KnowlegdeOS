import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDatabaseClient } from '../packages/database/src/client.ts';
import { loadConfig } from '../apps/api/src/config/env.ts';

type StageDecision = { required?: boolean; execution?: string; provider?: string; model?: string };
type StageResult = { status?: string; inputCandidateCount?: number; acceptedCount?: number; rejectedCount?: number; rejectionCounts?: Record<string, number> };
type IndexingRecord = {
  indexingPlan?: { version?: number; stages?: Record<string, StageDecision> };
  stageResults?: Record<string, StageResult>;
  traceId?: string;
};
type Operation = IndexingRecord & {
  id?: string;
  status?: string;
  retry?: { useLlm?: boolean; mode?: string };
  documentIndexing?: Record<string, IndexingRecord>;
};
type Finding = { operationFile: string; operationId?: string; documentName?: string; issue: string; detail?: string };

function option(name: string) {
  const equalsPrefix = `${name}=`;
  const index = process.argv.findIndex((item) => item === name || item.startsWith(equalsPrefix));
  if (index < 0) return undefined;
  return process.argv[index].startsWith(equalsPrefix) ? process.argv[index].slice(equalsPrefix.length) : process.argv[index + 1];
}

const root = option('--root') ?? 'storage/workspaces';
const output = option('--output');
const format = option('--format') ?? 'json';
const includeDatabase = process.argv.includes('--database');

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name === 'operations.json' ? [path.join(directory, entry.name)] : []));
  return nested.flat();
}

function inspectRecord(findings: Finding[], operationFile: string, operation: Operation, record: IndexingRecord, documentName?: string) {
  const prefix = { operationFile, operationId: operation.id, documentName };
  const plan = record.indexingPlan;
  const results = record.stageResults;
  if (!plan?.stages) return;
  if (!results) {
    findings.push({ ...prefix, issue: 'missing_stage_results', detail: 'An indexing plan was persisted without stage results.' });
    return;
  }
  for (const [stage, decision] of Object.entries(plan.stages)) {
    const result = results[stage];
    if (decision.required && !result) findings.push({ ...prefix, issue: 'missing_required_stage_result', detail: stage });
    if (!result) continue;
    if (result.rejectedCount && !result.rejectionCounts) findings.push({ ...prefix, issue: 'missing_rejection_diagnostics', detail: stage });
    if ((stage === 'aliases' || stage === 'relationships') && result.status === 'succeeded' && result.inputCandidateCount && result.acceptedCount === 0) {
      findings.push({ ...prefix, issue: 'graph_candidates_accepted_zero', detail: stage });
    }
    if ((stage === 'aliases' || stage === 'relationships') && result.inputCandidateCount && result.rejectedCount === result.inputCandidateCount) {
      findings.push({ ...prefix, issue: 'all_graph_candidates_rejected', detail: stage });
    }
  }
}

async function inspectDatabase(findings: Finding[]) {
  const config = loadConfig();
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const [staleAliases, staleRelationships, orphanEntities] = await Promise.all([
      client.db.execute("select ea.id, ea.document_id from entity_aliases ea left join documents d on d.id = ea.document_id where ea.source = 'LLM' and (ea.document_id is null or d.id is null)"),
      client.db.execute("select r.id, r.document_id from relationships r left join documents d on d.id = r.document_id where r.origin = 'LLM' and (r.document_id is null or d.id is null)"),
      client.db.execute("select e.id from entities e left join document_entities de on de.entity_id = e.id left join entity_aliases ea on ea.entity_id = e.id left join relationships rs on rs.source_entity_id = e.id left join relationships rt on rt.target_entity_id = e.id where de.id is null and ea.id is null and rs.id is null and rt.id is null")
    ]);
    const rowsOf = (result: unknown): Array<{ id: string }> => Array.isArray(result) ? result as Array<{ id: string }> : (result as { rows?: Array<{ id: string }> }).rows ?? [];
    const aliasRows = rowsOf(staleAliases);
    const relationshipRows = rowsOf(staleRelationships);
    const orphanRows = rowsOf(orphanEntities);
    for (const row of aliasRows) findings.push({ operationFile: 'database', issue: 'stale_llm_alias_without_document', detail: String(row.id) });
    for (const row of relationshipRows) findings.push({ operationFile: 'database', issue: 'stale_llm_relationship_without_document', detail: String(row.id) });
    for (const row of orphanRows) findings.push({ operationFile: 'database', issue: 'orphan_entity_without_graph_reference', detail: String(row.id) });
    return { inspected: true, staleAliases: aliasRows.length, staleRelationships: relationshipRows.length, orphanEntities: orphanRows.length };
  } finally {
    await client.close();
  }
}

function toText(report: { root: string; operationFilesScanned: number; operationsScanned: number; documentRecordsScanned: number; findingCount: number; findings: Finding[]; database?: { inspected: boolean; staleAliases: number; staleRelationships: number; orphanEntities: number } }) {
  const lines = [
    `Indexing graph audit: ${report.findingCount} finding(s) across ${report.operationsScanned} operation(s) and ${report.documentRecordsScanned} document record(s).`,
    `Root: ${report.root}`
  ];
  if (report.database) lines.push(`Database: ${report.database.staleAliases} stale LLM alias(es), ${report.database.staleRelationships} stale LLM relationship(s), ${report.database.orphanEntities} orphan entity record(s).`);
  for (const finding of report.findings) {
    lines.push(`- ${finding.issue}${finding.documentName ? ` [${finding.documentName}]` : ''}${finding.detail ? `: ${finding.detail}` : ''} (${finding.operationFile}${finding.operationId ? `, ${finding.operationId}` : ''})`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (!['json', 'text'].includes(format)) throw new Error('--format must be json or text.');
  const findings: Finding[] = [];
  let operationsScanned = 0;
  let documentRecordsScanned = 0;
  const operationFiles = await walk(root);
  for (const operationFile of operationFiles) {
    const operations = JSON.parse(await readFile(operationFile, 'utf8')) as Operation[];
    for (const operation of operations) {
      operationsScanned++;
      if (operation.retry?.useLlm !== undefined) findings.push({ operationFile, operationId: operation.id, issue: 'legacy_global_use_llm', detail: 'Historical operation; re-run to persist a stage-specific plan.' });
      if (operation.status === 'completed' && operation.stageResults && Object.values(operation.stageResults).some((stage) => stage.status === 'failed')) findings.push({ operationFile, operationId: operation.id, issue: 'completed_with_failed_stage' });
      const documentRecords = Object.entries(operation.documentIndexing ?? {});
      if (!documentRecords.length) inspectRecord(findings, operationFile, operation, operation);
      for (const [documentName, record] of documentRecords) {
        documentRecordsScanned++;
        inspectRecord(findings, operationFile, operation, record, documentName);
      }
    }
  }
  const database = includeDatabase ? await inspectDatabase(findings) : undefined;
  const report = { root, operationFilesScanned: operationFiles.length, operationsScanned, documentRecordsScanned, database, findingCount: findings.length, findings };
  const text = format === 'text' ? toText(report) : `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, text, 'utf8');
  process.stdout.write(text);
}

void main();
