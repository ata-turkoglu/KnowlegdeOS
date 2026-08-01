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
  batchSize: number;
  output?: string;
};

function values(flag: string) {
  return process.argv.flatMap((value, index) => value === flag && process.argv[index + 1] ? [process.argv[index + 1]!] : []);
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
  const config = loadConfig();
  const requestedDocuments = [...input.documents, ...(input.inputFile ? (await readFile(input.inputFile, 'utf8')).split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : [])];
  const report: { mode: 'dry-run' | 'apply'; metadataRegeneration: string; workspaces: Array<{ workspace: string; documents: string[]; indexed?: string[]; embeddings?: unknown }> } = {
    mode: input.apply ? 'apply' : 'dry-run',
    metadataRegeneration: 'This command indexes stored Markdown/YAML. Run the existing YAML generation workflow and metadata:audit before applying it.',
    workspaces: [],
  };
  for (const workspace of await workspaceNames(config, input)) {
    const available = await listStoredDocuments(config, workspace);
    const selected = requestedDocuments.length ? available.filter((item) => requestedDocuments.includes(item.documentName)) : available;
    if (requestedDocuments.length && selected.length !== requestedDocuments.length) {
      const found = new Set(selected.map((item) => item.documentName));
      const missing = requestedDocuments.filter((item) => !found.has(item));
      if (missing.length) throw new Error(`Documents not found in ${workspace}: ${missing.join(', ')}`);
    }
    const entry: { workspace: string; documents: string[]; indexed?: string[]; embeddings?: unknown } = { workspace, documents: selected.map((item) => item.documentName) };
    report.workspaces.push(entry);
    if (!input.apply || !selected.length) continue;
    const indexed: string[] = [];
    for (let offset = 0; offset < selected.length; offset += input.batchSize) {
      const batch = selected.slice(offset, offset + input.batchSize);
      for (const document of batch) {
        await reindexStoredDocument(config, { workspaceSlug: workspace, documentName: document.documentName, mode: 'automatic' });
        indexed.push(document.documentName);
      }
      await embedSelectedDocuments(config, workspace, batch.map((document) => document.documentName));
    }
    entry.indexed = indexed;
  }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (input.output) await writeFile(input.output, text, 'utf8');
  process.stdout.write(text);
}

void main();
