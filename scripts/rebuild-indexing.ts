import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../apps/api/src/config/env.ts';
import { listStoredDocuments, reindexStoredDocument } from '../apps/api/src/services/documents.ts';
import { embedSelectedDocuments } from '../apps/api/src/services/semantic-search.ts';

type Options = {
  workspaces: string[];
  documents: string[];
  inputFile?: string;
  allWorkspaces: boolean;
  apply: boolean;
  confirm: boolean;
  resume: boolean;
  retryFailed: boolean;
  batchSize: number;
  output?: string;
};

type RebuildFailure = { documentName: string; error: string };
type WorkspaceReport = {
  workspace: string;
  documents: string[];
  indexed?: string[];
  failed?: RebuildFailure[];
  embeddings?: unknown;
};
type PreviousReport = {
  workspaces?: Array<Pick<WorkspaceReport, 'workspace' | 'indexed' | 'failed'>>;
};

function values(flag: string) {
  const equalsPrefix = `${flag}=`;
  return process.argv.flatMap((value, index) => {
    if (value.startsWith(equalsPrefix)) return [value.slice(equalsPrefix.length)];
    return value === flag && process.argv[index + 1] ? [process.argv[index + 1]!] : [];
  });
}

function options(): Options {
  const batchSize = Number(values('--batch-size')[0] ?? '10');
  return {
    workspaces: values('--workspace'),
    documents: values('--document'),
    inputFile: values('--input-file')[0],
    allWorkspaces: process.argv.includes('--all-workspaces'),
    apply: process.argv.includes('--apply'),
    confirm: process.argv.includes('--confirm-rebuild'),
    resume: process.argv.includes('--resume'),
    retryFailed: process.argv.includes('--retry-failed'),
    batchSize: Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 10,
    output: values('--output')[0],
  };
}

async function workspaceNames(config: ReturnType<typeof loadConfig>, input: Options) {
  if (input.allWorkspaces) {
    const root = path.resolve(config.storageRoot, 'workspaces');
    return (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
  if (!input.workspaces.length) throw new Error('Provide --workspace=<slug> or --all-workspaces.');
  return [...new Set(input.workspaces)];
}

async function main() {
  const input = options();
  if (input.apply !== input.confirm) throw new Error('A rebuild is destructive to derived indexes. Use both --apply and --confirm-rebuild, or neither for a dry run.');
  if (input.resume && input.retryFailed) throw new Error('Use either --resume or --retry-failed, not both.');
  if ((input.resume || input.retryFailed) && !input.output) throw new Error('--resume and --retry-failed require --output=<prior-report.json>.');
  const config = loadConfig();
  const previous = input.resume || input.retryFailed
    ? JSON.parse(await readFile(input.output!, 'utf8')) as PreviousReport
    : undefined;
  const requestedDocuments = [...input.documents, ...(input.inputFile ? (await readFile(input.inputFile, 'utf8')).split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : [])];
  const report: { mode: 'dry-run' | 'apply'; metadataRegeneration: string; workspaces: WorkspaceReport[] } = {
    mode: input.apply ? 'apply' : 'dry-run',
    metadataRegeneration: 'This command indexes stored Markdown/YAML. Run the existing YAML generation workflow and metadata:audit before applying it.',
    workspaces: [],
  };
  for (const workspace of await workspaceNames(config, input)) {
    const available = await listStoredDocuments(config, workspace);
    const previousWorkspace = previous?.workspaces?.find((item) => item.workspace === workspace);
    const priorIndexed = new Set(previousWorkspace?.indexed ?? []);
    const priorFailed = previousWorkspace?.failed?.map((failure) => failure.documentName) ?? [];
    const requested = input.retryFailed ? priorFailed : requestedDocuments;
    const sourceCandidates = requested.length ? available.filter((item) => requested.includes(item.documentName)) : available;
    const selected = sourceCandidates
      .filter((item) => !input.resume || !priorIndexed.has(item.documentName));
    if (requested.length && sourceCandidates.length !== requested.length) {
      const found = new Set(sourceCandidates.map((item) => item.documentName));
      const missing = requested.filter((item) => !found.has(item));
      if (missing.length) throw new Error(`Documents not found in ${workspace}: ${missing.join(', ')}`);
    }
    const entry: WorkspaceReport = { workspace, documents: selected.map((item) => item.documentName) };
    report.workspaces.push(entry);
    if (!input.apply || !selected.length) continue;
    const indexed: string[] = [];
    const failed: RebuildFailure[] = [];
    for (let offset = 0; offset < selected.length; offset += input.batchSize) {
      const batch = selected.slice(offset, offset + input.batchSize);
      const completed: string[] = [];
      for (const document of batch) {
        try {
          await reindexStoredDocument(config, { workspaceSlug: workspace, documentName: document.documentName, mode: 'automatic' });
          indexed.push(document.documentName);
          completed.push(document.documentName);
        } catch (error) { failed.push({ documentName: document.documentName, error: error instanceof Error ? error.message : 'Reindex failed.' }); }
      }
      if (completed.length) entry.embeddings = await embedSelectedDocuments(config, workspace, completed);
    }
    entry.indexed = indexed;
    entry.failed = failed;
  }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (input.output) await writeFile(input.output, text, 'utf8');
  process.stdout.write(text);
  if (report.workspaces.some((workspace) => workspace.failed?.length)) process.exitCode = 1;
}

void main();
