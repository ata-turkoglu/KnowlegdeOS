import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseMarkdownFrontmatter } from '../packages/ingestion/src/frontmatter.ts';
import { getMetadataFieldPolicy, metadataFieldPolicies } from '../packages/shared/src/metadata-policy.ts';

type Finding = { file: string; field: string; issue: string };
const root = process.argv.find((item) => item.startsWith('--root='))?.slice(7) ?? 'converted-markdown';
const output = process.argv.find((item) => item.startsWith('--output='))?.slice(9);
const findings: Finding[] = [];

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name.endsWith('.md') ? [path.join(directory, entry.name)] : []));
  return nested.flat();
}

async function main() {
for (const file of await walk(root)) {
  const frontmatter = parseMarkdownFrontmatter(await readFile(file, 'utf8')).frontmatter;
  for (const [field, value] of Object.entries(frontmatter)) {
    const policy = getMetadataFieldPolicy(field);
    if (!policy) { findings.push({ file, field, issue: 'unknown_field' }); continue; }
    if (policy.semanticType === 'scalar' && Array.isArray(value)) findings.push({ file, field, issue: 'scalar_stored_as_array' });
    if (policy.semanticType === 'list' && !Array.isArray(value)) findings.push({ file, field, issue: 'list_stored_as_scalar' });
    if (policy.valueType === 'DATE' && typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) findings.push({ file, field, issue: 'invalid_iso_date' });
  }
  const date = frontmatter.date;
  const dateText = frontmatter.date_text;
  if (typeof date === 'string' && date && (!dateText || Array.isArray(dateText))) findings.push({ file, field: 'date_text', issue: 'date_text_missing_or_non_scalar_for_date' });
}
const byIssue = Object.groupBy(findings, (item) => item.issue);
const counts = Object.fromEntries(Object.entries(byIssue).map(([issue, entries]) => [issue, entries?.length ?? 0]));
const report = { root, scannedPolicies: metadataFieldPolicies.length, filesScanned: (await walk(root)).length, filesWithFindings: new Set(findings.map((item) => item.file)).size, counts, findings };
const text = `${JSON.stringify(report, null, 2)}\n`;
if (output) await writeFile(output, text, 'utf8');
process.stdout.write(text);
}

void main();
