import { and, count, eq } from 'drizzle-orm';
import {
  createDatabaseClient,
  documents,
  workspaces,
} from '@knowledgeos/database';
import type { ApiConfig } from '../config/env.js';
import { slugify } from '../lib/slug.js';
import { executionPlanHas, type ExecutionPlan } from './execution-planner.js';
import {
  resolveAnalysisDocumentIds,
  type QueryAnalysis,
} from './query-analyzer.js';

export type DirectExecutionResult = {
  count: number;
  exists: boolean;
  answer: string;
  rows: Array<{
    documentId?: string;
    documentName?: string;
    title?: string;
    date?: string | null;
    value?: string;
    count?: number;
  }>;
  executionMs: number;
};

/**
 * LLM gerektirmeyen deterministik execution planlarını doğrudan veritabanında çalıştırır.
 *
 * COUNT, EXISTS, TIMELINE/SORT, DISTINCT, GROUP_BY ve FACET işlemlerini yürütür.
 * Plan doğrudan çalıştırmaya uygun değilse `null` döndürür ve çağıranın normal
 * retrieval/LLM akışına devam etmesine izin verir.
 */
export async function executeDirectPlan(
  config: ApiConfig,
  workspaceSlug: string,
  analysis: QueryAnalysis,
  plan: ExecutionPlan,
  precomputed?: { documentIds: string[] | undefined },
): Promise<DirectExecutionResult | null> {
  if (plan.requiresLlmAnswer) return null;

  const started = performance.now();
  const constrainedIds = precomputed
    ? precomputed.documentIds
    : await resolveAnalysisDocumentIds(config, workspaceSlug, analysis);

  const client = createDatabaseClient(config.databaseUrl);

  try {
    const slug = slugify(workspaceSlug);
    const [workspace] = await client.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);

    if (!workspace) {
      return createDirectResult(
        'Eşleşen çalışma alanı bulunamadı.',
        [],
        started,
      );
    }

    // `undefined`, herhangi bir belge kısıtı olmadığını; boş dizi ise hiçbir
    // belgenin filtrelerle eşleşmediğini ifade eder.
    const allowedIds = constrainedIds ?? null;

    if (executionPlanHas(plan, 'COUNT') || executionPlanHas(plan, 'EXISTS')) {
      let documentCount = constrainedIds?.length;

      // Metadata veya entity kısıtı yoksa toplam indekslenmiş belge sayısı
      // doğrudan veritabanından hesaplanır.
      if (documentCount === undefined) {
        const [row] = await client.db
          .select({ value: count(documents.id) })
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, workspace.id),
              eq(documents.status, 'INDEXED'),
            ),
          );

        documentCount = Number(row?.value ?? 0);
      }

      const exists = documentCount > 0;
      const answer = executionPlanHas(plan, 'COUNT')
        ? `Eşleşen indekslenmiş belge sayısı: ${documentCount}.`
        : exists
          ? `Evet, eşleşen ${documentCount} indekslenmiş belge var.`
          : 'Hayır, eşleşen indekslenmiş belge yok.';

      return {
        count: documentCount,
        exists,
        answer,
        rows: [],
        executionMs: performance.now() - started,
      };
    }

    if (executionPlanHas(plan, 'SORT')) {
      const sortNode = plan.nodes.find((node) => node.op === 'SORT');
      const direction = sortNode?.direction === 'DESC' ? 'desc' : 'asc';
      const limit = normalizeDirectLimit(sortNode?.limit);
      const fieldId = sortNode?.fieldId ?? null;
      const fieldKey = sortNode?.fieldKey ?? 'date';

      const rows = await client.queryClient<
        Array<{
          document_id: string;
          filename: string;
          title: string;
          sort_date: string | null;
        }>
      >`
        select
          d.id as document_id,
          d.filename,
          d.title,
          coalesce(dfv.date_value, d.document_date)::text as sort_date
        from documents d
        left join lateral (
          select value.date_value
          from document_field_values value
          join workspace_fields field on field.id = value.field_id
          where value.document_id = d.id
            and value.date_value is not null
            and (
              (
                ${fieldId}::uuid is null
                and field.key in (${fieldKey}, 'date', 'date_range_start')
              )
              or value.field_id = ${fieldId}::uuid
            )
          order by
            case
              when field.key = ${fieldKey} then 0
              when field.key = 'date' then 1
              when field.key = 'date_range_start' then 2
              else 3
            end,
            value.ordinal
          limit 1
        ) dfv on true
        where d.workspace_id = ${workspace.id}
          and d.status = 'INDEXED'
          and (
            ${allowedIds}::uuid[] is null
            or d.id = any(${allowedIds}::uuid[])
          )
        order by
          case
            when ${direction} = 'asc'
              then coalesce(dfv.date_value, d.document_date)
          end asc nulls last,
          case
            when ${direction} = 'desc'
              then coalesce(dfv.date_value, d.document_date)
          end desc nulls last,
          d.filename asc
        limit ${limit}`;

      const output = rows.map((row) => ({
        documentId: row.document_id,
        documentName: documentName(row.filename),
        title: row.title,
        date: row.sort_date,
      }));

      const answer = output.length
        ? output
            .map(
              (row, index) =>
                `${index + 1}. ${row.date ?? 'Tarihsiz'} — ${row.title ?? row.documentName}`,
            )
            .join('\n')
        : 'Eşleşen tarihli belge bulunamadı.';

      return createDirectResult(answer, output, started);
    }

    const aggregateNode = plan.nodes.find((node) =>
      ['DISTINCT', 'GROUP_BY', 'FACET'].includes(node.op),
    );

    if (aggregateNode) {
      if (!aggregateNode.fieldId) {
        return createDirectResult(
          'Gruplama veya tekil değer işlemi için geçerli bir metadata alanı belirlenemedi.',
          [],
          started,
        );
      }

      const limit = normalizeDirectLimit(aggregateNode.limit);
      const rows = await client.queryClient<
        Array<{ value: string; item_count: number }>
      >`
        select
          min(dfv.text_value) as value,
          count(distinct d.id)::int as item_count
        from document_field_values dfv
        join documents d on d.id = dfv.document_id
        join workspace_fields field on field.id = dfv.field_id
        where field.workspace_id = ${workspace.id}
          and dfv.field_id = ${aggregateNode.fieldId}::uuid
          and d.status = 'INDEXED'
          and (
            ${allowedIds}::uuid[] is null
            or d.id = any(${allowedIds}::uuid[])
          )
          and dfv.normalized_value is not null
          and length(trim(dfv.normalized_value)) > 0
        group by dfv.normalized_value
        order by item_count desc, value asc
        limit ${limit}`;

      const output = rows.map((row) => ({
        value: row.value,
        count: Number(row.item_count),
      }));

      const answer = buildAggregateAnswer(aggregateNode.op, output);
      return createDirectResult(answer, output, started);
    }

    // Plan deterministik olarak işaretlenmiş olsa da bu engine tarafından
    // desteklenen doğrudan bir operasyon içermiyorsa normal akış devralır.
    return null;
  } finally {
    await client.close();
  }
}

/**
 * Doğrudan aggregation işleminin türüne göre kullanıcıya gösterilecek metni üretir.
 */
function buildAggregateAnswer(
  operation: 'DISTINCT' | 'GROUP_BY' | 'FACET',
  rows: Array<{ value?: string; count?: number }>,
) {
  if (!rows.length) return 'Bu alan için eşleşen değer bulunamadı.';

  if (operation === 'DISTINCT') {
    return rows
      .map((row, index) => `${index + 1}. ${row.value ?? ''}`)
      .join('\n');
  }

  return rows.map((row) => `${row.value ?? ''}: ${row.count ?? 0}`).join('\n');
}

/**
 * Execution planından gelen limit değerini güvenli 1-100 aralığına sınırlar.
 */
function normalizeDirectLimit(limit: number | undefined) {
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 20)));
}

/**
 * Satır tabanlı deterministik sonuçlar için ortak telemetri ve özet alanlarını oluşturur.
 */
function createDirectResult(
  answer: string,
  rows: DirectExecutionResult['rows'],
  started: number,
): DirectExecutionResult {
  return {
    count: rows.length,
    exists: rows.length > 0,
    answer,
    rows,
    executionMs: performance.now() - started,
  };
}

/**
 * Kaynak dosya adını uzantısından arındırıp kullanıcı arayüzünde kullanılan slug'a dönüştürür.
 */
function documentName(filename: string) {
  return slugify(filename.replace(/\.[^.]+$/, ''));
}
