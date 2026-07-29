import { and, count, eq } from "drizzle-orm";
import { createDatabaseClient, documents, workspaces } from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { executionPlanHas, type ExecutionPlan } from "./execution-planner.js";
import type { QueryAnalysis } from "./query-analyzer.js";
import { resolveAnalysisDocumentIds } from "./query-analyzer.js";

export type DirectExecutionResult = {
  count: number;
  exists: boolean;
  answer: string;
  rows: Array<{ documentId?: string; documentName?: string; title?: string; date?: string | null; value?: string; count?: number }>;
  executionMs: number;
};

export async function executeDirectPlan(
  config: ApiConfig,
  workspaceSlug: string,
  analysis: QueryAnalysis,
  plan: ExecutionPlan,
  precomputed?: { documentIds: string[] | undefined }
): Promise<DirectExecutionResult | null> {
  if (plan.requiresLlmAnswer) return null;
  const started = performance.now();
  const constrainedIds = precomputed
    ? precomputed.documentIds
    : await resolveAnalysisDocumentIds(config, workspaceSlug, analysis);
  const client = createDatabaseClient(config.databaseUrl);
  try {
    const slug = slugify(workspaceSlug);
    const [workspace] = await client.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!workspace) return result("Eşleşen çalışma alanı bulunamadı.", [], started);
    const allowedIds = constrainedIds ?? null;

    if (executionPlanHas(plan, "COUNT") || executionPlanHas(plan, "EXISTS")) {
      let documentCount = constrainedIds?.length;
      if (documentCount === undefined) {
        const [row] = await client.db.select({ value: count(documents.id) }).from(documents)
          .where(and(eq(documents.workspaceId, workspace.id), eq(documents.status, "INDEXED")));
        documentCount = Number(row?.value ?? 0);
      }
      const exists = documentCount > 0;
      const answer = executionPlanHas(plan, "COUNT")
        ? `Eşleşen indekslenmiş belge sayısı: ${documentCount}.`
        : exists ? `Evet, eşleşen ${documentCount} indekslenmiş belge var.` : "Hayır, eşleşen indekslenmiş belge yok.";
      return { count: documentCount, exists, answer, rows: [], executionMs: performance.now() - started };
    }

    if (executionPlanHas(plan, "SORT")) {
      const sort = plan.nodes.find((node) => node.op === "SORT");
      const direction = sort?.direction === "DESC" ? "desc" : "asc";
      const limit = sort?.limit ?? 20;
      const fieldId = sort?.fieldId ?? null;
      const rows = await client.queryClient<Array<{ document_id: string; filename: string; title: string; sort_date: string | null }>>`
        select d.id as document_id, d.filename, d.title, coalesce(dfv.date_value, d.document_date)::text as sort_date
        from documents d
        left join lateral (
          select value.date_value
          from document_field_values value
          join workspace_fields field on field.id = value.field_id
          where value.document_id = d.id
            and value.date_value is not null
            and (${fieldId}::uuid is null and field.key in ('date', 'date_range_start') or value.field_id = ${fieldId}::uuid)
          order by value.ordinal
          limit 1
        ) dfv on true
        where d.workspace_id = ${workspace.id} and d.status = 'INDEXED'
          and (${allowedIds}::uuid[] is null or d.id = any(${allowedIds}::uuid[]))
        order by
          case when ${direction} = 'asc' then coalesce(dfv.date_value, d.document_date) end asc nulls last,
          case when ${direction} = 'desc' then coalesce(dfv.date_value, d.document_date) end desc nulls last,
          d.filename asc
        limit ${limit}`;
      const output = rows.map((row) => ({ documentId: row.document_id, documentName: documentName(row.filename), title: row.title, date: row.sort_date }));
      const answer = output.length
        ? output.map((row, index) => `${index + 1}. ${row.date ?? "Tarihsiz"} — ${row.title ?? row.documentName}`).join("\n")
        : "Eşleşen tarihli belge bulunamadı.";
      return result(answer, output, started);
    }

    const aggregate = plan.nodes.find((node) => ["DISTINCT", "GROUP_BY", "FACET"].includes(node.op));
    if (aggregate) {
      if (!aggregate.fieldId) return result("Gruplama veya tekil değer işlemi için geçerli bir metadata alanı belirlenemedi.", [], started);
      const rows = await client.queryClient<Array<{ value: string; item_count: number }>>`
        select min(dfv.text_value) as value, count(distinct d.id)::int as item_count
        from document_field_values dfv
        join documents d on d.id = dfv.document_id
        join workspace_fields field on field.id = dfv.field_id
        where field.workspace_id = ${workspace.id}
          and dfv.field_id = ${aggregate.fieldId}::uuid
          and d.status = 'INDEXED'
          and (${allowedIds}::uuid[] is null or d.id = any(${allowedIds}::uuid[]))
          and dfv.normalized_value is not null
        group by dfv.normalized_value
        order by item_count desc, value asc
        limit ${aggregate.limit ?? 20}`;
      const output = rows.map((row) => ({ value: row.value, count: Number(row.item_count) }));
      const answer = output.length
        ? output.map((row) => `${row.value}: ${row.count}`).join("\n")
        : "Bu alan için eşleşen değer bulunamadı.";
      return result(answer, output, started);
    }
    return null;
  } finally {
    await client.close();
  }
}

function result(answer: string, rows: DirectExecutionResult["rows"], started: number): DirectExecutionResult {
  return { count: rows.length, exists: rows.length > 0, answer, rows, executionMs: performance.now() - started };
}

function documentName(filename: string) {
  return slugify(filename.replace(/\.[^.]+$/, ""));
}
