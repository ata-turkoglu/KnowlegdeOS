export type MetadataSemanticType = 'scalar' | 'list';
export type MetadataValueType = 'TEXT' | 'DATE' | 'NUMBER' | 'BOOLEAN';
export type MetadataMergeStrategy = 'system' | 'first' | 'best' | 'union' | 'concat' | 'date' | 'date_text';
export type MetadataGroundingPolicy = 'required' | 'generated' | 'none';
export type MetadataScalar = string | number | boolean;
export type MetadataValue = MetadataScalar | MetadataScalar[];
export type MetadataFieldPolicy = { key: string; semanticType: MetadataSemanticType; valueType: MetadataValueType; merge: MetadataMergeStrategy; grounding: MetadataGroundingPolicy; description: string; aliases?: string[] };

const scalar = (key: string, merge: MetadataMergeStrategy, grounding: MetadataGroundingPolicy, description: string, valueType: MetadataValueType = 'TEXT'): MetadataFieldPolicy => ({ key, semanticType: 'scalar', valueType, merge, grounding, description });
const list = (key: string, grounding: MetadataGroundingPolicy, description: string): MetadataFieldPolicy => ({ key, semanticType: 'list', valueType: 'TEXT', merge: 'union', grounding, description });

export const metadataFieldPolicies = [
  scalar('document_code', 'system', 'none', 'Application-assigned document identifier.'), scalar('source_original', 'system', 'none', 'Application-assigned original source filename.'), scalar('source_file', 'system', 'none', 'Application-assigned converted filename.'), scalar('ocr_status', 'system', 'none', 'Application-assigned conversion status.'), scalar('metadata_provider', 'system', 'none', 'Application-assigned metadata provenance.'),
  scalar('title', 'best', 'required', 'Document title.'), scalar('language', 'best', 'generated', 'Predominant ISO 639-1 document language.'), scalar('document_type', 'best', 'generated', 'Concise document classification.'), scalar('document_subtype', 'best', 'generated', 'Explicit document subtype.'), scalar('date', 'date', 'generated', 'Primary certain Gregorian document date.', 'DATE'), scalar('date_text', 'date_text', 'required', 'Source expression corresponding only to the selected primary date.'), scalar('date_range_start', 'date', 'required', 'Certain Gregorian range start.', 'DATE'), scalar('date_range_end', 'date', 'required', 'Certain Gregorian range end.', 'DATE'), scalar('issuer', 'best', 'required', 'Single explicit issuing party.'), scalar('recipient', 'best', 'required', 'Single explicit receiving party.'), scalar('summary', 'best', 'generated', 'One concise document-level summary.'), scalar('notes', 'concat', 'generated', 'Deduplicated document-level notes.'),
  list('people', 'required', 'People named in the document.'), { ...list('organizations', 'required', 'Organizations named in the document.'), aliases: ['organization'] }, list('places', 'required', 'Places named in the document.'), list('addresses', 'required', 'Complete postal addresses.'), list('parcels', 'required', 'Parcel identifiers.'), list('property_descriptions', 'required', 'Property descriptions.'), list('case_numbers', 'required', 'Case identifiers.'), list('notary_numbers', 'required', 'Notary identifiers.'), list('signatories', 'required', 'Signatories.'), list('witnesses', 'required', 'Witnesses.'), list('keywords', 'generated', 'Concise document keywords.'),
] as const satisfies readonly MetadataFieldPolicy[];

const policies = new Map(metadataFieldPolicies.map((policy) => [policy.key, policy]));
export function getMetadataFieldPolicy(key: string) { return policies.get(key) ?? metadataFieldPolicies.find((policy) => (policy.aliases as readonly string[] | undefined)?.includes(key)); }
export function isBuiltInMetadataField(key: string) { return policies.has(key); }
export function isSystemMetadataField(key: string) { return getMetadataFieldPolicy(key)?.merge === 'system'; }
export function metadataPromptFieldContract() {
  const llm = metadataFieldPolicies.filter((policy) => policy.merge !== 'system');
  const scalars = llm.filter((policy) => policy.semanticType === 'scalar').map((policy) => policy.key).join(', ');
  const lists = llm.filter((policy) => policy.semanticType === 'list').map((policy) => policy.key).join(', ');
  const system = metadataFieldPolicies.filter((policy) => policy.merge === 'system').map((policy) => policy.key).join(', ');
  return `Built-in scalar fields: ${scalars}. Built-in list fields: ${lists}. Do not return system-managed fields (${system}). Scalar fields must never be arrays; list fields must always be arrays of strings. Do not return nested objects or unknown fields.`;
}
export function metadataJsonSchema() {
  const properties = Object.fromEntries(metadataFieldPolicies.filter((policy) => policy.merge !== 'system').map((policy) => [policy.key, policy.semanticType === 'list' ? { type: 'array', items: { type: 'string' } } : policy.valueType === 'DATE' ? { type: 'string' } : policy.valueType === 'NUMBER' ? { type: 'number' } : policy.valueType === 'BOOLEAN' ? { type: 'boolean' } : { type: 'string' }]));
  return { type: 'object', properties, additionalProperties: false } as const;
}
