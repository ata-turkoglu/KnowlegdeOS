import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { normalizeForSearch } from '@knowledgeos/ingestion';
import {
  createDatabaseClient,
  documentChunks,
  documents,
  workspaces,
} from '@knowledgeos/database';
import type { ApiConfig } from '../config/env.js';
import { slugify } from '../lib/slug.js';
import {
  getEmbeddingProvider,
  selectedEmbeddingModel,
} from './ai-providers.js';
import { getWorkspaceIngestionSettings } from './workspace-settings.js';
import {
  extractLabeledNumericAnchors,
  type MetadataFilters,
} from './rag-core.js';
import { ragRetrievalCache } from './rag-cache.js';
import { extractDateSearchVariants } from './date-search.js';

export type SemanticSearchResult = {
  queryType: 'SEMANTIC_SEARCH';
  query: string;
  embeddingModel: string;
  results: Array<{
    documentId: string;
    chunkId: string;
    documentName: string;
    title: string;
    chunkIndex: number;
    heading: string | null;
    score: number;
    snippet: string;
  }>;
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    score: number;
  }>;
};

export type SemanticContextChunk = {
  documentId: string;
  chunkId: string;
  documentName: string;
  title: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  sourceType?: 'ENTITY' | 'SEMANTIC' | 'LEXICAL';
  score?: number;
  retrievers?: string[];
};

export type EmbeddingCoverageItem = {
  documentName: string;
  title: string;
  chunkCount: number;
  embeddedChunkCount: number;
  status: 'MISSING' | 'READY';
};

const embeddingDimensions = 1024;

/**
 * Veritabanı istemcisini açar, verilen işlemi çalıştırır ve sonuç ne olursa
 * olsun bağlantıyı güvenli biçimde kapatır.
 */
async function withDb<T>(
  config: ApiConfig,
  fn: (client: ReturnType<typeof createDatabaseClient>) => Promise<T>,
) {
  const client = createDatabaseClient(config.databaseUrl);

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Workspace slug değerinden veritabanı kimliğini çözer.
 *
 * Workspace bulunamazsa sessizce kapsam dışına çıkmak yerine açık hata üretir.
 */
async function workspaceId(
  db: ReturnType<typeof createDatabaseClient>['db'],
  slug: string,
) {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);

  if (!workspace) {
    throw new Error(`Workspace '${slug}' was not found.`);
  }

  return workspace.id;
}

/**
 * Kaynak dosya adını uzantısından arındırıp kararlı belge slug'ına dönüştürür.
 */
function documentName(filename: string) {
  return slugify(filename.replace(/\.[^.]+$/, ''));
}

/**
 * Embedding dizisini PostgreSQL pgvector literal biçimine dönüştürür.
 */
function vectorLiteral(values: number[]) {
  return `[${values.join(',')}]`;
}

/**
 * Embedding'in gerekli boyutta ve yalnız sonlu sayılardan oluştuğunu doğrular.
 */
function assertValidEmbedding(embedding: number[]) {
  if (embedding.length !== embeddingDimensions) {
    throw new Error(
      `The selected embedding model returned ${embedding.length} dimensions; this installation requires ${embeddingDimensions}. Choose a compatible model or configure it to return ${embeddingDimensions} dimensions.`,
    );
  }

  if (embedding.some((value) => !Number.isFinite(value))) {
    throw new Error(
      'The selected embedding model returned non-finite vector values.',
    );
  }
}

/**
 * Arama veya embedding işleminde kullanılacak limit değerini güvenli
 * 1-100 aralığına sınırlar.
 */
function normalizeLimit(requested: number | undefined, fallback: number) {
  const candidate = requested ?? fallback;

  if (!Number.isFinite(candidate)) return 20;

  return Math.max(1, Math.min(100, Math.trunc(candidate)));
}

/**
 * Metadata kapsamındaki belge kimliklerini SQL için hazırlar.
 *
 * `undefined`, kapsam kısıtı olmadığını; boş dizi ise hiçbir belgenin
 * eşleşmediğini ifade eder.
 */
function resolveAllowedDocumentIds(filters: MetadataFilters | undefined) {
  const ids = filters?.allowedDocumentIds;

  if (ids === undefined) return null;

  return [...new Set(ids.filter(isUuid))];
}

/**
 * Değerin PostgreSQL UUID biçiminde olup olmadığını doğrular.
 */
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

/**
 * Workspace içindeki indekslenmiş belgelerin seçili embedding modeli
 * bakımından kapsama durumunu döndürür.
 */
export async function getEmbeddingCoverage(
  config: ApiConfig,
  workspaceSlugInput: string,
): Promise<EmbeddingCoverageItem[]> {
  const slug = slugify(workspaceSlugInput);
  const model = selectedEmbeddingModel(config);

  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slug);

    const rows = await db
      .select({
        filename: documents.filename,
        title: documents.title,
        chunkCount: count(documentChunks.id),
        embedded: sql<number>`
          count(${documentChunks.id}) filter (
            where ${documentChunks.embedding} is not null
              and ${documentChunks.embeddingModel} = ${model}
          )
        `,
      })
      .from(documents)
      .leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
      .where(
        and(eq(documents.workspaceId, id), eq(documents.status, 'INDEXED')),
      )
      .groupBy(documents.id)
      .orderBy(documents.filename);

    return rows.map((row) => {
      const chunkCount = Number(row.chunkCount);
      const embeddedChunkCount = Number(row.embedded);

      return {
        documentName: documentName(row.filename),
        title: row.title,
        chunkCount,
        embeddedChunkCount,
        status:
          chunkCount > 0 && chunkCount === embeddedChunkCount
            ? 'READY'
            : 'MISSING',
      };
    });
  });
}

/**
 * Seçilen belgelerin eksik chunk embedding'lerini üretir.
 *
 * Aynı model ve content hash için mevcut bir embedding varsa yeniden üretmek
 * yerine onu kullanır. İşlem sonunda retrieval cache temizlenir.
 */
export async function embedSelectedDocuments(
  config: ApiConfig,
  workspaceSlugInput: string,
  names: string[],
  onProgress?: (value: {
    completed: number;
    total: number;
    documentName: string;
  }) => void,
  signal?: AbortSignal,
) {
  const slug = slugify(workspaceSlugInput);
  const model = selectedEmbeddingModel(config);
  const provider = getEmbeddingProvider(config);
  const selectedNames = new Set(names.map((value) => slugify(value)));

  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slug);

    // Upload dosyaları .md veya .txt olabileceği için workspace kapsamındaki
    // normalize dosya gövdeleri karşılaştırılır.
    const all = await db
      .select({
        id: documents.id,
        filename: documents.filename,
      })
      .from(documents)
      .where(eq(documents.workspaceId, id));

    const selected = all.filter((row) =>
      selectedNames.has(documentName(row.filename)),
    );

    let completed = 0;
    let reusedChunkCount = 0;
    let generatedChunkCount = 0;

    for (const document of selected) {
      throwIfAborted(signal);

      const currentDocumentName = documentName(document.filename);
      onProgress?.({
        completed,
        total: selected.length,
        documentName: currentDocumentName,
      });

      const chunks = await db
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, document.id))
        .orderBy(documentChunks.chunkIndex);

      for (const chunk of chunks) {
        throwIfAborted(signal);

        if (chunk.embedding && chunk.embeddingModel === model) {
          reusedChunkCount += 1;
          continue;
        }

        const [reusable] = await db
          .select({
            embedding: documentChunks.embedding,
          })
          .from(documentChunks)
          .where(
            and(
              eq(documentChunks.contentHash, chunk.contentHash),
              eq(documentChunks.embeddingModel, model),
              isNotNull(documentChunks.embedding),
            ),
          )
          .limit(1);

        if (reusable?.embedding) {
          await db
            .update(documentChunks)
            .set({
              embedding: reusable.embedding,
              embeddingModel: model,
            })
            .where(eq(documentChunks.id, chunk.id));

          reusedChunkCount += 1;
          continue;
        }

        const embedding = await provider.embed(chunk.content);
        assertValidEmbedding(embedding);

        await db
          .update(documentChunks)
          .set({
            embedding,
            embeddingModel: model,
          })
          .where(eq(documentChunks.id, chunk.id));

        generatedChunkCount += 1;
      }

      await db
        .update(documents)
        .set({
          embeddingModel: model,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, document.id));

      completed += 1;
      onProgress?.({
        completed,
        total: selected.length,
        documentName: currentDocumentName,
      });
    }

    ragRetrievalCache.invalidateWorkspace(slug);

    return {
      workspaceSlug: slug,
      embeddedDocumentCount: completed,
      reusedChunkCount,
      generatedChunkCount,
    };
  });
}

/**
 * Eski API adıyla embedding kapsam özetini döndürür.
 *
 * Vektörler doğrudan veritabanında tutulduğu için ayrıca dosya sistemi indeksi
 * yeniden oluşturulmaz.
 */
export async function rebuildSemanticIndex(
  config: ApiConfig,
  workspaceSlug: string,
) {
  const coverage = await getEmbeddingCoverage(config, workspaceSlug);

  return {
    workspaceSlug: slugify(workspaceSlug),
    chunks: coverage.reduce((sum, item) => sum + item.embeddedChunkCount, 0),
  };
}

/**
 * Uyumluluk fonksiyonudur.
 *
 * Reindex sırasında chunk satırları değiştirildiği için semantic indeks ayrıca
 * dosya sistemi seviyesinde invalidate edilmez.
 */
export async function invalidateSemanticIndex(
  _config: ApiConfig,
  _workspaceSlug: string,
) {
  // DB rows are invalidated by reindex replacement.
}

/**
 * Sorgu embedding'i ile pgvector cosine similarity araması çalıştırır.
 *
 * Planner tarafından boş belge kapsamı verilirse embedding sağlayıcısı dahi
 * çağrılmadan boş sonuç döndürülür.
 */
export async function searchSemanticDocuments(
  config: ApiConfig,
  input: {
    workspaceSlug: string;
    query: string;
    limit?: number;
    filters?: MetadataFilters;
  },
): Promise<SemanticSearchResult> {
  const slug = slugify(input.workspaceSlug);
  const model = selectedEmbeddingModel(config);
  const allowedIds = resolveAllowedDocumentIds(input.filters);

  if (Array.isArray(allowedIds) && allowedIds.length === 0) {
    return emptySemanticResult(input.query, model);
  }

  const queryText = input.query.trim();
  if (!queryText) {
    return emptySemanticResult(input.query, model);
  }

  const settings = await getWorkspaceIngestionSettings(config, slug);
  const limit = normalizeLimit(input.limit, settings.semanticTopK);
  const queryEmbedding = await getEmbeddingProvider(config).embed(queryText);
  assertValidEmbedding(queryEmbedding);
  const literal = vectorLiteral(queryEmbedding);

  return withDb(config, async ({ db, queryClient }) => {
    const id = await workspaceId(db, slug);

    // postgres.js vektör literalini parametreler. `<=>` cosine distance,
    // `1 - distance` ise benzerlik skorudur.
    const rows = await queryClient<
      Array<{
        document_id: string;
        chunk_id: string;
        filename: string;
        title: string;
        chunk_index: number;
        heading: string | null;
        content: string;
        score: number;
      }>
    >`
        select
          d.id as document_id,
          c.id as chunk_id,
          d.filename,
          d.title,
          c.chunk_index,
          c.heading,
          c.content,
          (
            1 - (
              c.embedding <=>
              ${literal}::vector
            )
          )::float8 as score
        from document_chunks c
        join documents d
          on d.id = c.document_id
        where d.workspace_id = ${id}
          and d.status = 'INDEXED'
          and d.embedding_model = ${model}
          and c.embedding_model = ${model}
          and c.embedding is not null
          and (
            ${allowedIds}::uuid[] is null
            or d.id = any(${allowedIds}::uuid[])
          )
          and (
            ${input.filters?.year ?? null}::text
              is null
            or extract(
              year from d.document_date
            )::text =
              ${input.filters?.year ?? null}
          )
          and (
            ${input.filters?.date ?? null}::date
              is null
            or d.document_date =
              ${input.filters?.date ?? null}::date
          )
          and (
            ${input.filters?.documentType ?? null}::text
              is null
            or d.document_type ilike
              ${
                input.filters?.documentType
                  ? `%${input.filters.documentType}%`
                  : null
              }
          )
        order by
          c.embedding <=> ${literal}::vector
        limit ${limit}`;

    const results = rows
      .map((row) => ({
        documentId: row.document_id,
        chunkId: row.chunk_id,
        documentName: documentName(row.filename),
        title: row.title,
        chunkIndex: row.chunk_index,
        heading: row.heading,
        score: Number(row.score),
        snippet: row.content.slice(0, 500),
      }))
      .filter(
        (row) =>
          Number.isFinite(row.score) &&
          row.score >= settings.similarityThreshold,
      );

    return {
      queryType: 'SEMANTIC_SEARCH',
      query: input.query,
      embeddingModel: model,
      results,
      sources: results.map((result) => ({
        documentName: result.documentName,
        title: result.title,
        evidenceSnippet: result.snippet,
        score: result.score,
      })),
    };
  });
}

/**
 * Semantic arama sonucu dönen chunk kimliklerinin tam içeriklerini getirir.
 *
 * SQL IN sorgusu sıralama garantisi vermediği için sonuçlar vektör aramasının
 * orijinal benzerlik sırasına göre yeniden dizilir.
 */
export async function getSemanticContext(
  config: ApiConfig,
  workspaceSlug: string,
  results: SemanticSearchResult['results'],
): Promise<SemanticContextChunk[]> {
  if (!results.length) return [];

  const chunkIds = [...new Set(results.map((result) => result.chunkId))];
  const scores = new Map(
    results.map((result) => [result.chunkId, result.score]),
  );

  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slugify(workspaceSlug));

    const rows = await db
      .select({
        documentId: documents.id,
        chunkId: documentChunks.id,
        filename: documents.filename,
        title: documents.title,
        chunkIndex: documentChunks.chunkIndex,
        heading: documentChunks.heading,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(
        and(
          eq(documents.workspaceId, id),
          inArray(documentChunks.id, chunkIds),
        ),
      );

    const byChunkId = new Map(rows.map((row) => [row.chunkId, row]));

    return results.flatMap((result) => {
      const row = byChunkId.get(result.chunkId);

      return row
        ? [
            {
              ...row,
              documentName: documentName(row.filename),
              sourceType: 'SEMANTIC' as const,
              score: scores.get(row.chunkId) ?? 0,
            },
          ]
        : [];
    });
  });
}

/**
 * Normalized chunk içeriğinde PostgreSQL full-text araması çalıştırır.
 *
 * Ada, pafta, parsel anchor'ları ve açık tarih varyantları tam metin
 * sonucundan bağımsız, deterministik içerik eşleşmeleri olarak da aranır.
 */
export async function getLexicalSemanticContext(
  config: ApiConfig,
  workspaceSlug: string,
  query: string,
  limit = 4,
  filters?: MetadataFilters,
): Promise<SemanticContextChunk[]> {
  const allowedIds = resolveAllowedDocumentIds(filters);

  if (Array.isArray(allowedIds) && allowedIds.length === 0) {
    return [];
  }

  const normalizedLimit = normalizeLimit(limit, 4);
  const terms = [
    ...new Set(
      query.toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    ),
  ];
  const anchors = extractLabeledNumericAnchors(query);
  const dateVariants = extractDateSearchVariants(query);

  if (!terms.length && !anchors.length && !dateVariants) {
    return [];
  }

  return withDb(config, async ({ db, queryClient }) => {
    const id = await workspaceId(db, slugify(workspaceSlug));
    const phrase = terms.join(' ');

    type LexicalRow = {
      document_id: string;
      chunk_id: string;
      filename: string;
      title: string;
      chunk_index: number;
      heading: string | null;
      content: string;
      score: number;
    };

    const rows = phrase
      ? await queryClient<LexicalRow[]>`
            select
              d.id as document_id,
              c.id as chunk_id,
              d.filename,
              d.title,
              c.chunk_index,
              c.heading,
              c.content,
              ts_rank_cd(
                to_tsvector(
                  'simple',
                  c.normalized_content
                ),
                websearch_to_tsquery(
                  'simple',
                  ${phrase}
                )
              )::float8 as score
            from document_chunks c
            join documents d
              on d.id = c.document_id
            where d.workspace_id = ${id}
              and d.status = 'INDEXED'
              and (
                ${allowedIds}::uuid[] is null
                or d.id = any(
                  ${allowedIds}::uuid[]
                )
              )
              and (
                ${filters?.year ?? null}::text
                  is null
                or extract(
                  year from d.document_date
                )::text =
                  ${filters?.year ?? null}
              )
              and (
                ${filters?.date ?? null}::date
                  is null
                or d.document_date =
                  ${filters?.date ?? null}::date
              )
              and (
                ${filters?.documentType ?? null}::text
                  is null
                or d.document_type ilike
                  ${filters?.documentType ? `%${filters.documentType}%` : null}
              )
              and to_tsvector(
                'simple',
                c.normalized_content
              ) @@ websearch_to_tsquery(
                'simple',
                ${phrase}
              )
            order by
              ts_rank_cd(
                to_tsvector(
                  'simple',
                  c.normalized_content
                ),
                websearch_to_tsquery(
                  'simple',
                  ${phrase}
                )
              ) desc,
              c.chunk_index asc
            limit ${normalizedLimit}`
      : [];

    const datePatterns = dateVariants
      ? [
          ...new Set(
            [
              dateVariants.normalizedNumeric,
              ...dateVariants.textualVariants.map(normalizeForSearch),
            ].map((variant) => `%${variant}%`),
          ),
        ]
      : [];
    const dateRows = datePatterns.length
      ? await queryClient<LexicalRow[]>`
            select
              d.id as document_id,
              c.id as chunk_id,
              d.filename,
              d.title,
              c.chunk_index,
              c.heading,
              c.content,
              2::float8 as score
            from document_chunks c
            join documents d
              on d.id = c.document_id
            where d.workspace_id = ${id}
              and d.status = 'INDEXED'
              and (
                ${allowedIds}::uuid[] is null
                or d.id = any(${allowedIds}::uuid[])
              )
              and (
                ${filters?.year ?? null}::text is null
                or extract(year from d.document_date)::text = ${filters?.year ?? null}
              )
              and (
                ${filters?.date ?? null}::date is null
                or d.document_date = ${filters?.date ?? null}::date
              )
              and (
                ${filters?.documentType ?? null}::text is null
                or d.document_type ilike
                  ${filters?.documentType ? `%${filters.documentType}%` : null}
              )
              and exists (
                select 1
                from unnest(${datePatterns}::text[]) date_pattern
                where c.normalized_content like date_pattern
              )
            order by d.filename asc, c.chunk_index asc
            limit ${normalizedLimit}`
      : [];

    const anchorMap = new Map(
      anchors.map((anchor) => [anchor.label, anchor.value]),
    );
    const pafta = anchorMap.get('pafta') ?? null;
    const ada = anchorMap.get('ada') ?? null;
    const parsel = anchorMap.get('parsel') ?? null;

    const anchorRows =
      pafta || ada || parsel
        ? await queryClient<LexicalRow[]>`
              select
                d.id as document_id,
                c.id as chunk_id,
                d.filename,
                d.title,
                c.chunk_index,
                c.heading,
                c.content,
                1::float8 as score
              from document_chunks c
              join documents d
                on d.id = c.document_id
              where d.workspace_id = ${id}
                and d.status = 'INDEXED'
                and (
                  ${allowedIds}::uuid[] is null
                  or d.id = any(
                    ${allowedIds}::uuid[]
                  )
                )
                and (
                  ${filters?.year ?? null}::text
                    is null
                  or extract(
                    year from d.document_date
                  )::text =
                    ${filters?.year ?? null}
                )
                and (
                  ${filters?.date ?? null}::date
                    is null
                  or d.document_date =
                    ${filters?.date ?? null}::date
                )
                and (
                  ${filters?.documentType ?? null}::text
                    is null
                  or d.document_type ilike
                    ${
                      filters?.documentType ? `%${filters.documentType}%` : null
                    }
                )
                and (
                  ${pafta}::text is null
                  or c.normalized_content ~
                    ${pafta ? labeledAnchorPattern('pafta', pafta) : null}
                )
                and (
                  ${ada}::text is null
                  or c.normalized_content ~
                    ${ada ? labeledAnchorPattern('ada', ada) : null}
                )
                and (
                  ${parsel}::text is null
                  or c.normalized_content ~
                    ${parsel ? labeledAnchorPattern('parsel', parsel) : null}
                )
              order by
                d.filename asc,
                c.chunk_index asc
              limit ${normalizedLimit}`
        : [];

    const merged = new Map<string, LexicalRow>();

    // Anchor eşleşmeleri kesin kimlik sinyali olduğu için önce eklenir.
    for (const row of [...dateRows, ...anchorRows, ...rows]) {
      const existing = merged.get(row.chunk_id);

      if (!existing || Number(row.score) > Number(existing.score)) {
        merged.set(row.chunk_id, row);
      }
    }

    return [...merged.values()].slice(0, normalizedLimit).map((row) => ({
      documentId: row.document_id,
      chunkId: row.chunk_id,
      documentName: documentName(row.filename),
      title: row.title,
      chunkIndex: row.chunk_index,
      heading: row.heading,
      content: row.content,
      sourceType: 'LEXICAL' as const,
      score: Number(row.score),
    }));
  });
}

/**
 * En güçlü chunk'ların aynı belge içindeki yakın komşularını getirir.
 *
 * Komşular kanıt sıralamasına katkı vermediği için skorları sıfır ve
 * retriever etiketleri NEIGHBOR olarak döndürülür.
 */
export async function getNeighborContext(
  config: ApiConfig,
  workspaceSlug: string,
  primary: SemanticContextChunk[],
  distance: number,
): Promise<SemanticContextChunk[]> {
  const safeDistance = Number.isFinite(distance)
    ? Math.max(0, Math.min(10, Math.trunc(distance)))
    : 0;

  if (!primary.length || safeDistance <= 0) {
    return [];
  }

  const documentIds = [
    ...new Set(
      primary
        .filter((chunk) => chunk.chunkIndex >= 0)
        .map((chunk) => chunk.documentId)
        .filter(isUuid),
    ),
  ];

  if (!documentIds.length) return [];

  const wanted = new Map<string, Set<number>>();

  for (const chunk of primary) {
    if (chunk.chunkIndex < 0) continue;

    const indexes = wanted.get(chunk.documentId) ?? new Set<number>();

    for (let offset = -safeDistance; offset <= safeDistance; offset += 1) {
      if (offset !== 0 && chunk.chunkIndex + offset >= 0) {
        indexes.add(chunk.chunkIndex + offset);
      }
    }

    wanted.set(chunk.documentId, indexes);
  }

  return withDb(config, async ({ db }) => {
    const id = await workspaceId(db, slugify(workspaceSlug));

    const rows = await db
      .select({
        documentId: documents.id,
        chunkId: documentChunks.id,
        filename: documents.filename,
        title: documents.title,
        chunkIndex: documentChunks.chunkIndex,
        heading: documentChunks.heading,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(
        and(eq(documents.workspaceId, id), inArray(documents.id, documentIds)),
      );

    return rows
      .filter((row) => wanted.get(row.documentId)?.has(row.chunkIndex))
      .sort(
        (left, right) =>
          left.documentId.localeCompare(right.documentId) ||
          left.chunkIndex - right.chunkIndex,
      )
      .map((row) => ({
        ...row,
        documentName: documentName(row.filename),
        sourceType: 'SEMANTIC' as const,
        score: 0,
        retrievers: ['NEIGHBOR'],
      }));
  });
}

/**
 * Semantic retriever çalıştırılmadığında ortak boş sonuç nesnesi oluşturur.
 */
function emptySemanticResult(
  query: string,
  embeddingModel: string,
): SemanticSearchResult {
  return {
    queryType: 'SEMANTIC_SEARCH',
    query,
    embeddingModel,
    results: [],
    sources: [],
  };
}

/**
 * Etiketli sayısal anchor için normalize chunk metninde kullanılacak güvenli
 * PostgreSQL regex desenini üretir.
 */
function labeledAnchorPattern(
  label: 'ada' | 'pafta' | 'parsel',
  value: string,
) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return `(^| )(${escapedValue} ${label}|${label}( (no|numara|numarali))? ${escapedValue})( |$)`;
}

/**
 * AbortSignal iptal edilmişse embedding işlemini kontrollü biçimde durdurur.
 */
function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error('Embedding cancelled.');
  }
}
