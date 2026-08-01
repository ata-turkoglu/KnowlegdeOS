import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Operation = {
  id?: string;
  status?: string;
  retry?: { useLlm?: boolean; mode?: string };
  indexingPlan?: { version?: number; stages?: Record<string, { execution?: string; provider?: string; model?: string }> };
  stageResults?: Record<string, { status?: string; acceptedCount?: number; rejectedCount?: number; rejectionCounts?: Record<string, number> }>;
};

const root = process.argv.find((item) => item.startsWith('--root='))?.slice(7) ?? 'storage/workspaces';
const output = process.argv.find((item) => item.startsWith('--output='))?.slice(9);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name === 'operations.json' ? [path.join(directory, entry.name)] : []));
  return nested.flat();
}

async function main() {
  const findings: Array<{ operationFile: string; operationId?: string; issue: string; detail?: string }> = [];
  let operationsScanned = 0;
  for (const operationFile of await walk(root)) {
    const operations = JSON.parse(await readFile(operationFile, 'utf8')) as Operation[];
    for (const operation of operations) {
      operationsScanned++;
      if (operation.retry?.useLlm !== undefined) findings.push({ operationFile, operationId: operation.id, issue: 'legacy_global_use_llm', detail: 'Historical operation; re-run to persist a stage-specific plan.' });
      if (operation.status === 'completed' && operation.stageResults && Object.values(operation.stageResults).some((stage) => stage.status === 'failed')) findings.push({ operationFile, operationId: operation.id, issue: 'completed_with_failed_stage' });
      for (const [stage, result] of Object.entries(operation.stageResults ?? {})) {
        if (result.rejectedCount && !result.rejectionCounts) findings.push({ operationFile, operationId: operation.id, issue: 'missing_rejection_diagnostics', detail: stage });
      }
    }
  }
  const report = { root, operationFilesScanned: (await walk(root)).length, operationsScanned, findingCount: findings.length, findings };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, text, 'utf8');
  process.stdout.write(text);
}

void main();
