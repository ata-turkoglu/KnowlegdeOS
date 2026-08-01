import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function toText(report: { root: string; operationFilesScanned: number; operationsScanned: number; documentRecordsScanned: number; findingCount: number; findings: Finding[] }) {
  const lines = [
    `Indexing graph audit: ${report.findingCount} finding(s) across ${report.operationsScanned} operation(s) and ${report.documentRecordsScanned} document record(s).`,
    `Root: ${report.root}`
  ];
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
  const report = { root, operationFilesScanned: operationFiles.length, operationsScanned, documentRecordsScanned, findingCount: findings.length, findings };
  const text = format === 'text' ? toText(report) : `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, text, 'utf8');
  process.stdout.write(text);
}

void main();
