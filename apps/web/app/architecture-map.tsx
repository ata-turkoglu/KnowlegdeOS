'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLanguage, type PlatformLanguage } from './language-context';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';

type WorkflowTab = 'chat' | 'upload' | 'search' | 'convert' | 'database';
type WorkflowNodeKind =
  | 'input'
  | 'deterministic'
  | 'local-llm'
  | 'api-llm'
  | 'decision'
  | 'safety'
  | 'storage'
  | 'output';
type WorkflowGroupId = string;
type WorkflowGroup = {
  id: WorkflowGroupId;
  label: string;
  description: string;
};
type WorkflowNodeData = {
  nodeId?: string;
  title: string;
  subtitle: string;
  kind: WorkflowNodeKind;
  detail: string;
  rules?: string[];
  section?: string;
  group?: WorkflowGroupId;
  technicalTitle?: string;
  vertical?: boolean;
  modelKey?:
    | 'metadataLlmModel'
    | 'queryNormalizerModel'
    | 'queryAnalyzerModel'
    | 'ocrCorrectorModel'
    | 'conversationSummaryModel'
    | 'evidencePreparerModel'
    | 'contradictionDetectorModel'
    | 'entityLinkerModel'
    | 'rerankerModel'
    | 'apiRerankerModel'
    | 'fieldMatcherModel'
    | 'llmModel'
    | 'embeddingModel';
};
type WorkflowNode = Node<WorkflowNodeData, 'workflow' | 'workflow-group'>;
type ModelSettings = {
  llmModel: string;
  metadataLlmModel: string;
  embeddingModel: string;
  queryNormalizerModel: string;
  queryAnalyzerModel: string;
  ocrCorrectorModel: string;
  conversationSummaryModel: string;
  evidencePreparerModel: string;
  contradictionDetectorModel: string;
  entityLinkerModel: string;
  rerankerModel: string;
  apiRerankerModel: string;
  apiRerankerProvider: string;
  fieldMatcherModel: string;
  llmProvider?: string;
  embeddingProvider?: string;
};

const apiBaseUrl = 'http://127.0.0.1:4000';

const localizedGroupCopy: Record<
  string,
  Record<PlatformLanguage, { title: string; description: string }>
> = {
  request: {
    tr: {
      title: 'İstek ve Oturum',
      description: 'İstek sınırı, oturum geçmişi ve konuşma belleği',
    },
    en: {
      title: 'Request & Session',
      description: 'Request boundary, session history, and conversation memory',
    },
  },
  memory: {
    tr: {
      title: 'Sorgu Anlama',
      description: 'Normalizasyon, niyet, filtreler ve yürütme planı',
    },
    en: {
      title: 'Query Understanding',
      description: 'Normalization, intent, filters, and execution planning',
    },
  },
  planning: {
    tr: {
      title: 'Yürütme Yönlendirmesi',
      description: 'Doğrudan SQL yanıtları ve retrieval tabanlı yanıtlar',
    },
    en: {
      title: 'Execution Routing',
      description: 'Direct SQL answers versus retrieval-based answers',
    },
  },
  retrieval: {
    tr: {
      title: 'Retrieval',
      description: 'Hybrid search, recovery, fusion ve reranking',
    },
    en: {
      title: 'Retrieval',
      description: 'Hybrid search, recovery, fusion, and reranking',
    },
  },
  evidence: {
    tr: {
      title: 'Kanıt Hazırlama',
      description: 'Context budgeting, evidence selection, safety ve conflicts',
    },
    en: {
      title: 'Evidence Preparation',
      description:
        'Context budgeting, evidence selection, safety, and conflicts',
    },
  },
  generation: {
    tr: {
      title: 'Yanıt Üretimi',
      description: 'Template shortcut, grounded generation ve validation',
    },
    en: {
      title: 'Answer Generation',
      description: 'Template shortcuts, grounded generation, and validation',
    },
  },
  delivery: {
    tr: {
      title: 'Kalıcı Kayıt ve Teslim',
      description: 'Geçmiş, telemetry ve SSE yanıt teslimi',
    },
    en: {
      title: 'Persistence & Delivery',
      description: 'History, telemetry, and SSE response delivery',
    },
  },
  'upload-intake': {
    tr: {
      title: 'Kaynak Alımı',
      description: 'Dosya seçimi, doğrulama ve çakışma işlemleri',
    },
    en: {
      title: 'Source Intake',
      description: 'File selection, validation, and conflict handling',
    },
  },
  'upload-storage': {
    tr: {
      title: 'Saklama ve İş Kurulumu',
      description: 'Kaynak saklama ve indexleme işi oluşturma',
    },
    en: {
      title: 'Storage & Job Setup',
      description: 'Source persistence and indexing job creation',
    },
  },
  'upload-processing': {
    tr: {
      title: 'Belge İşleme',
      description:
        'Normalizasyon, chunking, extraction, linking ve kalite kontrolü',
    },
    en: {
      title: 'Document Processing',
      description:
        'Normalization, chunking, extraction, linking, and quality control',
    },
  },
  'upload-index': {
    tr: {
      title: 'Arama İndeksi',
      description: 'Kalıcı indeks ve embedding işlemleri',
    },
    en: {
      title: 'Search Index',
      description: 'Persisted index and embeddings',
    },
  },
  'upload-writes': {
    tr: {
      title: 'Veritabanı Yazımları',
      description: 'Belge, chunk, metadata, entity, link ve vector kayıtları',
    },
    en: {
      title: 'Database Writes',
      description: 'Documents, chunks, metadata, entities, links, and vectors',
    },
  },
  'search-planning': {
    tr: {
      title: 'Sorgu Planlama',
      description: 'Doğrulama, analiz, kapsam ve strateji seçimi',
    },
    en: {
      title: 'Query Planning',
      description: 'Validation, analysis, scope, and strategy selection',
    },
  },
  'search-retrieval': {
    tr: {
      title: 'Retrieval',
      description: 'Entity, vector, lexical ve hybrid retrieval',
    },
    en: {
      title: 'Retrieval',
      description: 'Entity, vector, lexical, and hybrid retrieval',
    },
  },
  'search-output': {
    tr: {
      title: 'Sonuçlar',
      description: 'Kaynaklar, skorlar, snippet’ler ve yürütme ayrıntıları',
    },
    en: {
      title: 'Results',
      description: 'Sources, scores, snippets, and execution details',
    },
  },
  'convert-source': {
    tr: {
      title: 'Kaynak Dönüşümü',
      description: 'DOCX doğrulama, saklama, dönüşüm ve inceleme',
    },
    en: {
      title: 'Source Conversion',
      description: 'DOCX validation, storage, conversion, and review',
    },
  },
  'convert-metadata': {
    tr: {
      title: 'Metadata Zenginleştirme',
      description: 'İsteğe bağlı YAML metadata üretimi ve doğrulama',
    },
    en: {
      title: 'Metadata Enrichment',
      description: 'Optional YAML metadata generation and validation',
    },
  },
  'convert-output': {
    tr: {
      title: 'Indexleme Devri',
      description: 'Upload ve indexing için hazır Markdown',
    },
    en: {
      title: 'Ingestion Handoff',
      description: 'Markdown ready for upload and indexing',
    },
  },
  'database-workspace': {
    tr: {
      title: 'Workspace Kapsamı',
      description: 'Workspace sahipliği ve dinamik alan tanımları',
    },
    en: {
      title: 'Workspace Scope',
      description: 'Workspace ownership and dynamic field definitions',
    },
  },
  'database-documents': {
    tr: {
      title: 'Belge ve Metadata',
      description:
        'Belgeler, chunk’lar, metadata değerleri ve property bilgileri',
    },
    en: {
      title: 'Document & Metadata',
      description: 'Documents, chunks, metadata values, and property facts',
    },
  },
  'database-entities': {
    tr: {
      title: 'Entity Graph',
      description: 'Canonical entity, alias, mention ve relationship kayıtları',
    },
    en: {
      title: 'Entity Graph',
      description: 'Canonical entities, aliases, mentions, and relationships',
    },
  },
  'database-chat': {
    tr: {
      title: 'Chat ve Telemetry',
      description: 'Oturumlar, mesajlar ve query execution kayıtları',
    },
    en: {
      title: 'Chat & Telemetry',
      description: 'Sessions, messages, and query execution records',
    },
  },
};

const localizedNodeTitles: Record<
  string,
  Partial<Record<PlatformLanguage, string>>
> = {
  question: { tr: 'Kullanıcı Sorusu', en: 'User Question' },
  'request-validation': { tr: 'İstek Doğrulama' },
  'memory-decision': { tr: 'Konuşma Özeti Gerekli mi?' },
  'conversation-memory': { tr: 'Konuşma Özeti' },
  normalize: { tr: 'Sorgu Normalizasyonu', en: 'Query Normalization' },
  analysis: { tr: 'Niyet ve Filtre Analizi', en: 'Intent & Filter Analysis' },
  'locked-rules': { tr: 'Deterministik Analiz Temeli' },
  planner: { tr: 'Sorgu Yürütme Planlayıcısı' },
  'direct-decision': { tr: 'Doğrudan Veritabanı Yanıtı?' },
  'direct-execution': { tr: 'Doğrudan SQL Yürütme' },
  'parallel-retrieval': {
    tr: 'Paralel Hibrit Retrieval',
    en: 'Parallel Hybrid Retrieval',
  },
  'empty-results': { tr: 'Sonuç Bulundu mu?' },
  recovery: { tr: 'Sıfır Sonuç Kurtarma' },
  fusion: { tr: 'Reciprocal Rank Fusion (RRF)' },
  'anchor-decision': { tr: 'Sayısal Anchor Var mı?' },
  'hybrid-router': { tr: 'Hibrit Rerank Yönlendiricisi' },
  rerank: { tr: 'Yerel Reranking', en: 'Local Reranking' },
  'api-rerank': { tr: 'Hibrit API Reranker' },
  context: { tr: 'Context Assembly ve Budgeting' },
  evidence: { tr: 'Kanıt Seçimi', en: 'Evidence Selection' },
  safety: { tr: 'Kanıt Sanitization' },
  conflicts: { tr: 'Kanıt Çelişki Tespiti', en: 'Evidence Conflict Detection' },
  'shortcut-decision': { tr: 'Şablon Yanıt Var mı?' },
  generation: {
    tr: 'Grounded Yanıt Üretimi',
    en: 'Grounded Answer Generation',
  },
  'citation-validation': { tr: 'Citation ve Grounding Doğrulama' },
  persist: { tr: 'Kalıcı Kayıt ve Teslim' },
  'read-chat-history': { tr: 'Chat Geçmişini Oku' },
  'read-chat-evidence': { tr: 'Retrieval Kanıtını Oku' },
  'write-chat-history': { tr: 'Chat Geçmişini Yaz' },
  'write-telemetry': { tr: 'Query Telemetry Yaz' },
  file: { en: 'Source File' },
  'upload-validation': { tr: 'Yükleme İsteği Doğrulama' },
  conflict: { tr: 'Yinelenen ve Çakışma Kontrolü' },
  reject: { tr: 'Yükleme Çakışmasını Çöz' },
  store: { tr: 'Kaynak Dosyalarını Sakla' },
  'document-record': { tr: 'Belge Kaydı Oluştur' },
  'index-start': { tr: 'Indexleme İşini Başlat' },
  'llm-extract': {
    tr: 'Yerel Metadata Çıkarımı',
    en: 'Local Metadata Extraction',
  },
  alias: { tr: 'Entity Alias Çözümleme' },
  quality: { tr: 'Ingestion Kalite Kontrolü' },
  'persist-index': { tr: 'Arama İndeksini Kaydet' },
  embedding: { tr: 'Embedding Üretimi', en: 'Embedding Generation' },
  'vector-ready': { tr: 'Vector İndeksi Hazır' },
  'search-query': { tr: 'Arama Sorgusu' },
  'search-validation': { tr: 'Arama İsteği Doğrulama' },
  'search-analysis': { tr: 'Arama Niyeti Analizi' },
  'search-plan': { tr: 'Belge Kapsamı Planlama' },
  'search-mode': { tr: 'Arama Stratejisi' },
  'entity-search': { tr: 'Entity Resolution Search' },
  'semantic-embedding': { tr: 'Sorgu Embedding Üretimi' },
  'vector-search': { tr: 'Vector Similarity Search' },
  'lexical-search': { tr: 'Lexical ve Anchor Search' },
  rrf: { tr: 'Hibrit Rank Fusion (RRF)' },
  'search-results': { tr: 'Arama Sonuçlarını Döndür' },
  'word-file': { tr: 'DOCX Kaynak Dosyası' },
  'docx-check': { tr: 'DOCX Doğrulama' },
  'conversion-storage': { tr: 'Kaynak Belgeyi Sakla' },
  pandoc: { tr: 'Pandoc Dönüşümü' },
  'markdown-review': { tr: 'Markdown İnceleme ve Bölme' },
  'yaml-decision': { tr: 'YAML Metadata Üretilsin mi?' },
  'metadata-context': { tr: 'Metadata Context Yükle' },
  'metadata-llm': { tr: 'YAML Metadata Üretimi' },
  'yaml-validation': { tr: 'YAML Doğrulama ve Yazma' },
  'converted-ready': { tr: 'Ingestion için Hazır' },
  'workspace-schema': { tr: 'workspace tablosu' },
  'fields-schema': { tr: 'workspace_fields tablosu' },
  'documents-schema': { tr: 'documents tablosu' },
  'sessions-schema': { tr: 'chat_sessions tablosu' },
  'telemetry-schema': { tr: 'query_executions tablosu' },
  'values-schema': { tr: 'document_field_values tablosu' },
  'entities-schema': { tr: 'entities tablosu' },
  'chunks-schema': { tr: 'document_chunks tablosu' },
  'property-schema': { tr: 'property_references tablosu' },
  'messages-schema': { tr: 'chat_messages tablosu' },
  'aliases-schema': { tr: 'entity_aliases tablosu' },
  'document-entities-schema': { tr: 'document_entities tablosu' },
  'chunk-entities-schema': { tr: 'chunk_entities tablosu' },
  'relationships-schema': { tr: 'relationships tablosu' },
};

const technicalSubtitles: Record<string, string> = {
  question: 'Message, workspace, session',
  normalize: 'OCR and spelling correction',
  analysis: 'Intent, filters, entity candidates',
  rerank: 'Default evidence ranking',
  'api-rerank': 'For ambiguous candidates',
  evidence: 'Verifiable evidence quotes',
  conflicts: 'Date, amount, and name conflicts',
  generation: 'RAG prompt and main LLM',
  'read-chat-history': 'chat_sessions and chat_messages',
  'read-chat-evidence': 'documents, chunks, and entities',
  'write-chat-history': 'chat_sessions and chat_messages',
  'write-telemetry': 'query_executions',
};

function localizedNodeTitle(
  data: WorkflowNodeData,
  language: PlatformLanguage,
) {
  const groupCopy = data.nodeId
    ? localizedGroupCopy[data.nodeId]?.[language]
    : undefined;
  if (groupCopy) return groupCopy.title;
  return data.nodeId
    ? (localizedNodeTitles[data.nodeId]?.[language] ??
        (language === 'en' ? (data.technicalTitle ?? data.title) : data.title))
    : data.title;
}

function technicalSubtitle(data: WorkflowNodeData) {
  return data.nodeId
    ? (technicalSubtitles[data.nodeId] ?? data.subtitle)
    : data.subtitle;
}

function localizedNodeDetail(
  data: WorkflowNodeData,
  language: PlatformLanguage,
) {
  const groupCopy = data.nodeId
    ? localizedGroupCopy[data.nodeId]?.[language]
    : undefined;
  if (groupCopy) return groupCopy.description;
  return language === 'en'
    ? `This workflow step handles ${technicalSubtitle(data)}.`
    : data.detail;
}

function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowNode>) {
  const { language } = useLanguage();
  const targetPosition = data.vertical ? Position.Top : Position.Left;
  const sourcePosition = data.vertical ? Position.Bottom : Position.Right;
  return (
    <article
      className={`workflow-node workflow-node--${data.kind}${selected ? ' is-selected' : ''}`}
    >
      <Handle type="target" position={targetPosition} />
      <span className="workflow-node__kind">
        {localizedNodeKindLabel(data.kind, language)}
      </span>
      {data.section ? (
        <span className="workflow-node__group">{data.section}</span>
      ) : data.group ? (
        <span className="workflow-node__group">
          {chatGroups.find((group) => group.id === data.group)?.label}
        </span>
      ) : null}
      <strong>{localizedNodeTitle(data, language)}</strong>
      <small>{technicalSubtitle(data)}</small>
      <Handle type="source" position={sourcePosition} />
    </article>
  );
}

function WorkflowGroupNode({ data }: NodeProps<WorkflowNode>) {
  const { language } = useLanguage();
  return (
    <div className="workflow-group-node">
      <strong>{localizedNodeTitle(data, language)}</strong>
      <small>{localizedNodeDetail(data, language)}</small>
    </div>
  );
}

const nodeTypes = {
  workflow: WorkflowNodeCard,
  'workflow-group': WorkflowGroupNode,
};

function nodeKindLabel(kind: WorkflowNodeKind) {
  return {
    input: 'Girdi',
    deterministic: 'Rule-Based',
    'local-llm': 'Local LLM',
    'api-llm': 'API LLM',
    decision: 'Karar',
    safety: 'Güvenlik',
    storage: 'Veri',
    output: 'Çıktı',
  }[kind];
}

function localizedNodeKindLabel(
  kind: WorkflowNodeKind,
  language: PlatformLanguage,
) {
  if (language === 'en')
    return {
      input: 'Input',
      deterministic: 'Rule-Based',
      'local-llm': 'Local LLM',
      'api-llm': 'API LLM',
      decision: 'Decision',
      safety: 'Safety',
      storage: 'Data',
      output: 'Output',
    }[kind];
  return nodeKindLabel(kind);
}

const chatGroups: WorkflowGroup[] = [
  {
    id: 'request',
    label: 'Request & Session',
    description: 'Request boundary, session history, and conversation memory',
  },
  {
    id: 'memory',
    label: 'Query Understanding',
    description: 'Normalization, intent, filters, and execution planning',
  },
  {
    id: 'planning',
    label: 'Execution Routing',
    description: 'Direct SQL answers versus retrieval-based answers',
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    description: 'Hybrid search, recovery, fusion, and reranking',
  },
  {
    id: 'evidence',
    label: 'Evidence Preparation',
    description: 'Context budgeting, evidence selection, safety, and conflicts',
  },
  {
    id: 'generation',
    label: 'Answer Generation',
    description: 'Template shortcuts, grounded generation, and validation',
  },
  {
    id: 'delivery',
    label: 'Persistence & Delivery',
    description: 'History, telemetry, and SSE response delivery',
  },
];

const chatNodeGroups: Record<string, WorkflowGroupId> = {
  question: 'request',
  'request-validation': 'request',
  'read-chat-history': 'request',
  'memory-decision': 'request',
  'conversation-memory': 'request',
  normalize: 'memory',
  analysis: 'memory',
  'locked-rules': 'memory',
  planner: 'planning',
  'direct-decision': 'planning',
  'direct-execution': 'planning',
  'parallel-retrieval': 'retrieval',
  'read-chat-evidence': 'retrieval',
  'empty-results': 'retrieval',
  recovery: 'retrieval',
  'recovery-retrieval': 'retrieval',
  fusion: 'retrieval',
  'anchor-decision': 'retrieval',
  'hybrid-router': 'retrieval',
  rerank: 'retrieval',
  'api-rerank': 'retrieval',
  context: 'evidence',
  evidence: 'evidence',
  safety: 'evidence',
  conflicts: 'evidence',
  'shortcut-decision': 'generation',
  generation: 'generation',
  'citation-validation': 'generation',
  persist: 'delivery',
  'write-chat-history': 'delivery',
  'write-telemetry': 'delivery',
};

const chatTechnicalTitles: Record<string, string> = {
  question: 'User Question',
  'request-validation': 'Request Validation',
  'memory-decision': 'Conversation Summary Needed?',
  'conversation-memory': 'Conversation Summary',
  normalize: 'Query Normalization',
  analysis: 'Intent & Filter Analysis',
  'locked-rules': 'Deterministic Analysis Baseline',
  planner: 'Query Execution Planner',
  'direct-decision': 'Direct Database Answer?',
  'direct-execution': 'Direct SQL Execution',
  'parallel-retrieval': 'Parallel Hybrid Retrieval',
  'empty-results': 'Results Found?',
  recovery: 'Zero-Result Recovery',
  'recovery-retrieval': 'Recovery Retrieval',
  fusion: 'Reciprocal Rank Fusion (RRF)',
  'anchor-decision': 'Numeric Anchor Present?',
  'hybrid-router': 'Hybrid Rerank Router',
  rerank: 'Local Reranking',
  'api-rerank': 'API Reranker',
  context: 'Context Assembly & Budgeting',
  evidence: 'Evidence Selection',
  safety: 'Evidence Sanitization',
  conflicts: 'Evidence Conflict Detection',
  'shortcut-decision': 'Template Answer Available?',
  generation: 'Grounded Answer Generation',
  'citation-validation': 'Citation & Grounding Validation',
  persist: 'Persist & Deliver',
  'read-chat-history': 'READ chat history',
  'read-chat-evidence': 'READ retrieval evidence',
  'write-chat-history': 'WRITE chat history',
  'write-telemetry': 'WRITE query telemetry',
};

const chatNodes: WorkflowNode[] = [
  node(
    'question',
    0,
    300,
    'Kullanıcı sorusu',
    'Mesaj, workspace, session',
    'input',
    'POST /api/chat isteği alınır; mesaj, çalışma alanı ve varsa oturum bilgisi akışa girer.',
  ),
  node(
    'request-validation',
    250,
    300,
    'Request Validation',
    'Schema and boundary checks',
    'deterministic',
    'Mesaj boş olamaz; uzunluk, workspace slug, UUID ve izin verilen alanlar doğrulanır.',
    [
      'Boş mesaj reddedilir',
      'Mesaj üst sınırı: 20.000 karakter',
      'Bilinmeyen request alanları kabul edilmez',
    ],
  ),
  node(
    'memory-decision',
    500,
    300,
    'Conversation Summary Needed?',
    '6+ turn or 3,000+ characters',
    'decision',
    'Yalnızca uzun geçmişlerde özet üretmek için Yerel LLM çağrılır. Kısa geçmiş doğrudan geçilir.',
  ),
  node(
    'conversation-memory',
    750,
    90,
    'Conversation Summary',
    'Summarize prior turns',
    'local-llm',
    'Seçili model sadece kullanıcının amacı, doğrulanmış bilgiler ve açık talepler için JSON özet üretir; hata olursa boş özetle devam eder.',
    undefined,
    'conversationSummaryModel',
  ),
  node(
    'normalize',
    750,
    300,
    'Sorgu normalleştirme',
    'Yazım / klavye düzeltme',
    'local-llm',
    'Sayılar, tarihler, belge kodları ve niyet korunarak en fazla üç güvenli arama varyantı üretilir. Orijinal sorgu recovery varyantları arasında korunur; şüpheli özel ad değişiklikleri ana sorgunun yerine geçmez.',
    [
      "NFC normalizasyonu ve boşluk temizliği deterministik fallback'tir",
      'Orijinal sorgu güvenli recovery varyantları arasında korunur',
      'Sayısal tokenların adedi, sırası veya yazımı değişen varyant reddedilir',
      'Şüpheli özel ad düzeltmeleri yalnız arama varyantı olarak kullanılabilir',
    ],
    'queryNormalizerModel',
  ),
  node(
    'analysis',
    1010,
    300,
    'Niyet ve filtre analizi',
    'Niyet, filtre, entity adayı',
    'local-llm',
    "Önce DB'den alanlar, entity ve metadata adayları bulunur. Seçili model sadece bu izinli bağlamla JSON önerir; çıktı doğrulanıp deterministik analizle birleştirilir.",
    undefined,
    'queryAnalyzerModel',
  ),
  node(
    'locked-rules',
    1010,
    90,
    'Deterministic Analysis Baseline',
    'Locked filters inside analysis',
    'deterministic',
    'Açık tarihin belge tarihi mi olay içeriği mi hedeflediği belirlenir. Belge tarihi, belge türü, sayısal anchor ve kesin katalog eşleşmeleri kilitli filtreye dönüşür; düşük güvenli LLM filtresi bunları değiştiremez.',
  ),
  node(
    'planner',
    1270,
    300,
    'Query Execution Planner',
    'Plan, cost and capabilities',
    'deterministic',
    'İndeksli belge sayısı, embedding kapsamı ve filtre seçiciliğine göre doğrulanmış execution plan oluşturulur. Kesin metadata veya entity kapsamı yeterliyse gereksiz lexical ya da semantic arama plana eklenmez.',
  ),
  node(
    'direct-decision',
    1530,
    300,
    'Direct Database Answer?',
    'COUNT / EXISTS / FACET / TIMELINE',
    'decision',
    'Sayma, varlık, tekil değer, gruplama, facet ve timeline niyetleri LLM olmadan deterministik planla yürütülür.',
  ),
  node(
    'direct-execution',
    1790,
    100,
    'Direct SQL Execution',
    'Aggregate, sort and limit',
    'deterministic',
    'Filtreli belge kümesi üzerinde SQL çalışır. Cevap doğrudan oluşturulur; model çağrısı yapılmaz.',
    ['COUNT ve EXISTS', 'DISTINCT / GROUP_BY / FACET', 'Tarih sıralı timeline'],
  ),
  node(
    'parallel-retrieval',
    1790,
    430,
    'Parallel Retrieval',
    'Entity, lexical and semantic',
    'deterministic',
    "Plana göre entity lookup, lexical ve semantic aramalar paralel çalışır. Normalizer recovery varyantı kullanıldığında aynı sorgu bütün etkin retriever'lara iletilir. Aynı retrieval isteği cache'den de karşılanabilir.",
  ),
  node(
    'empty-results',
    2050,
    430,
    'Results Found?',
    'Zero-candidate check',
    'decision',
    "Sonuç yoksa önce normalizer'ın güvenli arama varyantları denenir. Hâlâ boşsa yalnız düşük güvenli, LLM kaynaklı filtreler gevşetilebilir.",
  ),
  node(
    'recovery',
    2310,
    590,
    'Zero-Result Recovery',
    'Controlled second retrieval',
    'deterministic',
    'Kilitli RULE/CATALOG filtreleri korunur. Sadece düşük güvenli ve kilitli olmayan LLM filtreleri çıkarılır. Belge kapsamı yeniden çözülür ve execution plan gevşetilmiş analizle tekrar hazırlanır.',
  ),
  node(
    'recovery-retrieval',
    2570,
    650,
    'Recovery Retrieval',
    'Replanned controlled retrieval',
    'deterministic',
    'Gevşetilmiş analiz ve yeniden oluşturulan execution plan ile etkin entity, lexical ve semantic aramalar tekrar çalıştırılır.',
  ),
  node(
    'fusion',
    2310,
    350,
    'Result Fusion (RRF)',
    'Merge retriever rankings',
    'deterministic',
    "Birden fazla retrieval kolu varsa her retriever içindeki tekrarlar önce tekilleştirilir; aynı chunk farklı retriever'larda görünürse rank katkıları reciprocal-rank fusion ile birleştirilir.",
  ),
  node(
    'anchor-decision',
    2830,
    350,
    'Numeric Anchor Present?',
    'Block, sheet, parcel or explicit ID',
    'decision',
    'Ada, pafta ve parsel gibi etiketli sayısal kimliklerin tamamını aynı kanıt parçasında taşıyan adaylar deterministik olarak öne alınır; serbest semantik sinyalden daha güçlü kabul edilir.',
  ),
  node(
    'hybrid-router',
    3090,
    350,
    'Hybrid Rerank Router',
    'Deterministic ambiguity check',
    'decision',
    "Sayısal anchor ve açık retrieval sinyallerinde API çağrılmaz. En iyi iki adayın skorları yakınsa, sınırlı kanıt seti seçili API reranker'a yönlendirilir.",
  ),
  node(
    'rerank',
    3350,
    530,
    'Yerel yeniden sıralama',
    'Varsayılan kanıt sıralaması',
    'local-llm',
    "Varsayılan yol local reranker'dır. API çağrısı kapalıysa veya retrieval sinyali açıksa bu düğüm adayları sıralar.",
    undefined,
    'rerankerModel',
  ),
  node(
    'api-rerank',
    3350,
    40,
    'API Reranker',
    'Belirsiz adaylar için',
    'api-llm',
    'Yalnız belirsiz sıralamada en fazla altı kısa aday kanıt seçili API modeline gönderilir. API hata verirse aynı adaylar yerel reranker ile güvenli biçimde yeniden sıralanır.',
    undefined,
    'apiRerankerModel',
  ),
  node(
    'context',
    3610,
    350,
    'Context Assembly & Budgeting',
    'Neighbor chunks and token budget',
    'deterministic',
    "En iyi chunk'ların komşuları eklenir; modelin bağlam penceresine sığmak için düşük ilgili kaynaklar çıkarılır.",
  ),
  node(
    'evidence',
    3870,
    350,
    'Kanıt alıntısı seçimi',
    'Doğrulanabilir alıntılar',
    'local-llm',
    'Bağlam uzun ve çok kaynaklıysa seçili model kısa, birebir alıntılar seçer. Kaynakta geçmeyen alıntılar kabul edilmez.',
    undefined,
    'evidencePreparerModel',
  ),
  node(
    'safety',
    4130,
    350,
    'Evidence Sanitization',
    'Injection and PII removal',
    'safety',
    'Kaynaklardaki talimat enjeksiyonları çıkarılır; e-posta, IBAN, telefon, TC ve kart bilgileri maskelenir.',
  ),
  node(
    'conflicts',
    4390,
    350,
    'Kaynak çelişkisi kontrolü',
    'Tarih / tutar / isim',
    'local-llm',
    'Birden çok kaynakta, yalnız kaynakta birebir bulunan açık çelişkiler aranır. Çelişki referansları yalnız nihai context içinde kalan kaynaklara göre yeniden numaralandırılır ve ana prompta görünür biçimde eklenir.',
    undefined,
    'contradictionDetectorModel',
  ),
  node(
    'shortcut-decision',
    4650,
    350,
    'Template Answer Available?',
    'Greeting or single source',
    'decision',
    'Selamlaşma ya da tek kaynaklı belge listeleme isteği, ana LLM çağırmadan güvenli şablon yanıtla tamamlanır.',
  ),
  node(
    'generation',
    4910,
    530,
    'Kaynaklı cevap üretimi',
    'RAG prompt + cevap modeli',
    'api-llm',
    'Sistem promptu, soru, konuşma özeti, güvenli kanıtlar ve varsa çelişkiler seçili cevap modeline gönderilir.',
    undefined,
    'llmModel',
  ),
  node(
    'citation-validation',
    5170,
    530,
    'Citation & Grounding Validation',
    'Evidence and source checks',
    'safety',
    'İlk yanıt citation, sayısal değer ve kaynak desteği açısından doğrulanır. Hata varsa bir doğrulama düzeltmesi, ardından gerekirse en güçlü tek kaynakla son güvenli üretim yapılır.',
  ),
  node(
    'persist',
    5430,
    350,
    'Persist & Deliver',
    'Session history and SSE',
    'output',
    'Doğrulanmış cevap ve kaynaklar geçmişe kaydedilir. Streaming isteğinde final cevap 80 karakterlik SSE parçalarıyla iletilir.',
  ),
  node(
    'read-chat-history',
    500,
    700,
    'READ chat history',
    'chat_sessions and chat_messages',
    'storage',
    'Bir session ID varsa önce `chat_sessions` ve `chat_messages` tablolarından geçmiş okunur; uzun geçmiş için Conversation Summary düğümüne aktarılır.',
  ),
  node(
    'read-chat-evidence',
    2050,
    780,
    'READ retrieval evidence',
    'documents, chunks and entities',
    'storage',
    'Chat retrieval; metadata kapsamı için `documents` ve `document_field_values`, entity kanıtı için bridge tabloları, lexical/semantic kanıt için `document_chunks` okur.',
  ),
  node(
    'write-chat-history',
    5430,
    700,
    'WRITE chat history',
    'chat_sessions and chat_messages',
    'storage',
    'Doğrulanmış kullanıcı mesajı, cevap ve `sources_json`, oturum tablolarına INSERT edilir; session updated_at değeri güncellenir.',
  ),
  node(
    'write-telemetry',
    5170,
    860,
    'WRITE query telemetry',
    'query_executions',
    'storage',
    'Plan, query hash, strateji, tahmini/gerçek satır sayısı, süreler ve fallback bilgisi `query_executions` tablosuna yazılır.',
  ),
];

const chatEdges = workflowEdges([
  ['question', 'request-validation'],
  ['question', 'read-chat-history', 'session ID'],
  ['read-chat-history', 'memory-decision', 'SELECT'],
  ['request-validation', 'memory-decision'],
  ['memory-decision', 'conversation-memory', 'Evet'],
  ['memory-decision', 'normalize', 'Hayır'],
  ['conversation-memory', 'normalize'],
  ['normalize', 'locked-rules', 'Normalized query'],
  ['normalize', 'analysis', 'Normalized query + DB candidates'],
  ['locked-rules', 'analysis', 'Locked RULE filters'],
  ['analysis', 'planner'],
  ['planner', 'direct-decision'],
  ['direct-decision', 'direct-execution', 'Evet'],
  ['direct-decision', 'parallel-retrieval', 'Hayır'],
  ['direct-execution', 'persist'],
  ['parallel-retrieval', 'read-chat-evidence', 'SELECT / JOIN / vector'],
  ['read-chat-evidence', 'empty-results'],
  ['empty-results', 'recovery', 'Hayır'],
  ['empty-results', 'fusion', 'Evet'],
  ['recovery', 'recovery-retrieval'],
  ['recovery-retrieval', 'fusion'],
  ['fusion', 'anchor-decision'],
  ['anchor-decision', 'context', 'Evet: deterministic'],
  ['anchor-decision', 'hybrid-router', 'Hayır'],
  ['hybrid-router', 'rerank', 'Yerel'],
  ['hybrid-router', 'api-rerank', 'Belirsiz'],
  ['rerank', 'context'],
  ['api-rerank', 'context', 'API / yerel fallback'],
  ['context', 'evidence'],
  ['evidence', 'safety'],
  ['safety', 'conflicts'],
  ['conflicts', 'shortcut-decision'],
  ['shortcut-decision', 'persist', 'Evet'],
  ['shortcut-decision', 'generation', 'Hayır'],
  ['generation', 'citation-validation'],
  ['citation-validation', 'persist'],
  ['persist', 'write-chat-history', 'INSERT'],
  ['persist', 'write-telemetry', 'INSERT'],
]);

const chatNodesGrouped: WorkflowNode[] = (() => {
  const chatVerticalOffsets: Record<string, number> = {
    'api-rerank': -120,
    rerank: 150,
    'read-chat-evidence': 180,
    recovery: 100,
    'recovery-retrieval': 200,
    evidence: 180,
    safety: 360,
    conflicts: 540,
    generation: 180,
    'citation-validation': 360,
    'write-chat-history': 180,
    'write-telemetry': 360,
  };
  const children = chatNodes.map((item) => ({
    ...item,
    position: {
      ...item.position,
      y: item.position.y + (chatVerticalOffsets[item.id] ?? 0),
    },
    data: {
      ...item.data,
      group: chatNodeGroups[item.id],
      section: chatGroups.find((group) => group.id === chatNodeGroups[item.id])
        ?.label,
      technicalTitle: chatTechnicalTitles[item.id],
    },
  }));
  const groups: WorkflowNode[] = [];
  const groupedChildren: WorkflowNode[] = [];
  const verticalGroups = new Set<WorkflowGroupId>([
    'evidence',
    'generation',
    'delivery',
  ]);
  const chatVerticalOrder: Record<string, number> = {
    context: 0,
    evidence: 1,
    safety: 2,
    conflicts: 3,
    'shortcut-decision': 0,
    generation: 1,
    'citation-validation': 2,
    persist: 0,
    'write-chat-history': 1,
    'write-telemetry': 2,
  };
  const chatGroupPositions: Record<WorkflowGroupId, { x: number; y: number }> =
    {
      request: { x: 0, y: 40 },
      memory: { x: 1350, y: 60 },
      planning: { x: 2100, y: 80 },
      retrieval: { x: 3200, y: 340 },
      evidence: { x: 5700, y: 380 },
      generation: { x: 6120, y: 420 },
      delivery: { x: 6540, y: 160 },
    };
  const horizontalScale = 1.25;

  for (const group of chatGroups) {
    const members = children.filter((item) => item.data.group === group.id);
    const vertical = verticalGroups.has(group.id);
    const minX = Math.min(...members.map((item) => item.position.x));
    const maxX = Math.max(...members.map((item) => item.position.x));
    const minY = Math.min(...members.map((item) => item.position.y));
    const maxY = Math.max(...members.map((item) => item.position.y));
    const padding = 34;
    const groupHeaderHeight = 72;
    const groupId = `chat-group-${group.id}`;
    const width = vertical
      ? 205 + padding * 2
      : (maxX - minX) * horizontalScale + 205 + padding * 2;
    const height = vertical
      ? members.length * 132 + padding * 2 + groupHeaderHeight
      : maxY - minY + 82 + padding * 2 + groupHeaderHeight;
    const orderedMembers = vertical
      ? [...members].sort(
          (a, b) => chatVerticalOrder[a.id] - chatVerticalOrder[b.id],
        )
      : members;

    groups.push({
      id: groupId,
      type: 'workflow-group',
      position: chatGroupPositions[group.id],
      data: {
        nodeId: group.id,
        title: group.label,
        subtitle: group.description,
        kind: 'input',
        detail: '',
      },
      style: { width, height },
      selectable: false,
      draggable: false,
      zIndex: -1,
    });
    groupedChildren.push(
      ...orderedMembers.map((item, index) => ({
        ...item,
        data: { ...item.data, vertical },
        parentId: groupId,
        extent: 'parent' as const,
        position: vertical
          ? { x: padding, y: padding + groupHeaderHeight + index * 132 }
          : {
              x: (item.position.x - minX) * horizontalScale + padding,
              y: item.position.y - minY + padding + groupHeaderHeight,
            },
      })),
    );
  }

  return [...groups, ...groupedChildren];
})();

const uploadNodes: WorkflowNode[] = [
  node(
    'file',
    0,
    300,
    'Dosya seçimi',
    'Markdown + isteğe bağlı orijinal',
    'input',
    'Kullanıcı Markdown çalışma kopyasını ve isteğe bağlı orijinal taramayı seçer. Dönüştürülmüş dosyalar da kuyruktan eklenebilir.',
  ),
  node(
    'upload-validation',
    260,
    300,
    'Upload Request Validation',
    'Multipart and workspace checks',
    'deterministic',
    'Markdown dosyası zorunludur. Aynı çalışma alanında eşzamanlı operasyon varsa istek 409 ile engellenir.',
  ),
  node(
    'conflict',
    520,
    300,
    'Duplicate & Conflict Check',
    'New, duplicate or conflict',
    'decision',
    'Dosya adı ve SHA-256 içeriğine göre yeni dosya, yinelenen dosya veya isim çakışması ayrıştırılır.',
  ),
  node(
    'reject',
    780,
    100,
    'Resolve Upload Conflict',
    'Duplicate or conflicting file',
    'output',
    'Yinelenen ya da çakışan dosya indeksleme kuyruğuna alınmaz; kullanıcı seçim yapar.',
  ),
  node(
    'store',
    780,
    430,
    'Persist Source Files',
    'Original and Markdown copies',
    'storage',
    'Markdown çalışma kopyası ve varsa orijinal dosya workspace storage altında saklanır; upload operasyonu kayda alınır.',
  ),
  node(
    'document-record',
    1040,
    430,
    'Create Document Record',
    'Document and metadata',
    'storage',
    "Belge, dosya hash'i, başlık ve storage yolları veritabanına yazılır. Bu noktada belge indekslenmeye hazırdır.",
  ),
  node(
    'index-start',
    1300,
    430,
    'Start Indexing Job',
    'Batch operation and cancellation',
    'deterministic',
    'İndeksleme operasyonu tekil çalışır. Her belge için ilerleme kaydı tutulur ve istenirse iptal sinyali ile kesilebilir.',
  ),
  node(
    'normalize-doc',
    1560,
    430,
    'Text Normalization & Frontmatter',
    'Markdown and YAML parsing',
    'deterministic',
    'Markdown NFC/text normalizasyonundan geçer. Frontmatter varsa ayrılır; yoksa fallback metadata kullanılır.',
  ),
  node(
    'chunk',
    1820,
    430,
    'Heading-Aware Chunking',
    'Heading and page boundaries',
    'deterministic',
    'Başlık veya [Sayfa n] sınırları korunur. Varsayılan hedef 420 kelime, 60 kelime overlap ile chunk üretilir.',
  ),
  node(
    'ocr-correction',
    2080,
    650,
    'OCR düzeltme',
    'Belirgin OCR gürültüsü',
    'local-llm',
    "Yalnız kalite kontrolünün aday gösterdiği chunk'larda belirgin OCR gürültüsü düzeltilir; sayılar, tarihler, kodlar ve özel adlar korunur.",
    [
      "Yalnız OCR_ARTIFACTS ve LOW_TEXT_DENSITY işaretli chunk'lar değerlendirilir",
      'Sayısal tokenların adedi, sırası ve yazımı aynen korunmalıdır',
      'Eksik, tekrar eden veya şüpheli model çıktısı reddedilir',
      'Model hatasında kaynak chunk değiştirilmeden korunur',
    ],
    'ocrCorrectorModel',
  ),
  node(
    'extract',
    2340,
    430,
    'Rule-Based Entity Extraction',
    'Entities and property references',
    'deterministic',
    'Frontmatter ve içerikten kural tabanlı entity/property referansları çıkarılır.',
  ),
  node(
    'llm-extract-decision',
    2600,
    430,
    'Resolve Indexing Plan',
    'Independent stage routing',
    'decision',
    'Her indeksleme isteği kalıcı bir plan üretir. Deterministik entity çıkarımı zorunludur; alias, ilişki, claim ve özet aşamaları kendi sağlayıcı/model kararıyla bağımsız yürür veya atlanır.',
  ),
  node(
    'llm-extract',
    2860,
    650,
    'Independent Graph Stages',
    'Aliases, relationships, claims, summary',
    'local-llm',
    'Planlanan LLM aşamaları ayrı prompt ve çağrılarla çalışır. Kanıtsız adaylar reddedilir; tüm adaylar reddedilirse mevcut graph kayıtları korunur. entityLinkerModel bu aşamada rota seçmez.',
    undefined,
    'llmModel',
  ),
  node(
    'field-match',
    3120,
    650,
    'Metadata alan eşleme',
    'Workspace field adayları',
    'local-llm',
    'Yeni metadata anahtarları, seçili embedding modeliyle mevcut workspace alan adaylarına eşlenir; sonuç eşik ve fark kurallarıyla doğrulanır.',
    undefined,
    'fieldMatcherModel',
  ),
  node(
    'alias',
    3120,
    430,
    'Entity Alias Resolution',
    'Canonical entity linking',
    'deterministic',
    'Canonical değerler ve açık alias yazımları aynı entity altında bağlanır. Belirsiz kişi adı benzerlikleri otomatik birleştirilmez; chunk kanıt offsetleri orijinal metin üzerinden doğrulanır.',
  ),
  node(
    'quality',
    3380,
    430,
    'Ingestion Quality Check',
    'Short, duplicate and OCR artifacts',
    'safety',
    "Chunk'lar kısa metin, tekrar, OCR artefaktı ve düşük metin yoğunluğu açısından denetlenir; sorunlar raporlanır.",
  ),
  node(
    'persist-index',
    3640,
    430,
    'Persist Search Index',
    'Chunks, entities and relations',
    'storage',
    "İşlenmiş chunk'lar, alan değerleri, varlıklar ve ilişkiler PostgreSQL'e kaydedilir; belge INDEXED olur.",
  ),
  node(
    'embedding',
    3900,
    430,
    'Vektör üretimi',
    'Seçili embedding modeli',
    'storage',
    'İndeksleme tamamlanınca embedding operasyonu başlar. Hata veya iptal halinde semantic index invalidate edilir.',
    undefined,
    'embeddingModel',
  ),
  node(
    'vector-ready',
    4160,
    430,
    'Vector Index Ready',
    'Semantic and hybrid search',
    'output',
    "Embedding'ler pgvector/semantic indeks içinde hazır olduğunda belge Search ve Chat RAG akışına katılır.",
  ),
  node(
    'write-document',
    1040,
    720,
    'WRITE documents',
    'UPSERT source and lifecycle',
    'storage',
    'Yükleme sırasında kaynak Markdown, hash, frontmatter, storage yolları ve `UPLOADED` durumu `documents` tablosuna INSERT/UPSERT edilir.',
  ),
  node(
    'write-chunks',
    1820,
    720,
    'WRITE document_chunks',
    'INSERT normalized chunks',
    'storage',
    'Chunking sonucunda her içerik parçası heading, normalized content, token count ve content hash ile `document_chunks` tablosuna yazılır.',
  ),
  node(
    'write-fields',
    2080,
    900,
    'WRITE document_field_values',
    'INSERT typed metadata',
    'storage',
    'Frontmatter ve extraction verileri, `workspace_fields` şemasına göre text/date/number/boolean değerler olarak `document_field_values` tablosuna yazılır.',
  ),
  node(
    'write-entities',
    2860,
    720,
    'UPSERT entities & aliases',
    'Canonical values and spellings',
    'storage',
    "Canonical entity'ler `entities` tablosunda upsert edilir; kaynak ve kullanıcı alias'ları `entity_aliases` tablosuna bağlanır.",
  ),
  node(
    'write-links',
    3120,
    900,
    'WRITE evidence links',
    'Document, chunk and relation bridges',
    'storage',
    'Kanıt bağlantıları `document_entities`, `chunk_entities`, `relationships` ve `property_references` tablolarına yazılır.',
  ),
  node(
    'write-claims',
    3380,
    1080,
    'WRITE claims',
    'Grounded statements and events',
    'storage',
    'Model extraction etkinse, kaynakta birebir doğrulanan özne-yüklem-nesne ifadeleri ve tarih aralıkları `claims` tablosuna yazılır; kaynak chunk bulunamayan claim reddedilir.',
  ),
  node(
    'write-vectors',
    3640,
    720,
    'UPDATE chunk embeddings',
    'Vector and embedding model',
    'storage',
    'Embedding üretimi, `document_chunks.embedding` ve `embedding_model` alanlarını; belge modeli bilgisini `documents.embedding_model` alanını günceller.',
  ),
];

const uploadEdges = workflowEdges([
  ['file', 'upload-validation'],
  ['upload-validation', 'conflict'],
  ['conflict', 'reject', 'Duplicate / conflict'],
  ['conflict', 'store', 'Yeni'],
  ['store', 'document-record'],
  ['document-record', 'index-start'],
  ['index-start', 'normalize-doc'],
  ['normalize-doc', 'chunk'],
  ['chunk', 'ocr-correction'],
  ['ocr-correction', 'extract'],
  ['extract', 'llm-extract-decision', 'Deterministic entities always persist'],
  ['llm-extract-decision', 'llm-extract', 'Per-stage LLM route / skip'],
  ['llm-extract-decision', 'field-match', 'Metadata fields'],
  ['llm-extract', 'field-match', 'Independent result'],
  ['llm-extract', 'write-claims', 'Grounded candidates only'],
  ['field-match', 'alias'],
  ['store', 'write-document', 'INSERT / UPSERT'],
  ['normalize-doc', 'write-document', 'UPDATE'],
  ['chunk', 'write-chunks', 'INSERT'],
  ['extract', 'write-fields', 'INSERT'],
  ['alias', 'write-entities', 'UPSERT'],
  ['alias', 'write-links', 'INSERT / UPSERT'],
  ['alias', 'quality'],
  ['quality', 'persist-index'],
  ['persist-index', 'write-fields', 'INSERT'],
  ['persist-index', 'write-links', 'INSERT'],
  ['persist-index', 'embedding'],
  ['embedding', 'write-vectors', 'UPDATE'],
  ['embedding', 'vector-ready'],
]);

const searchNodes: WorkflowNode[] = [
  node(
    'search-query',
    0,
    300,
    'Arama sorgusu',
    'Entity, semantic veya hybrid',
    'input',
    'Kullanıcı Arama ekranından sorgu ve isteğe bağlı limit gönderir. Endpoint seçimi entity, semantic ya da hybrid olabilir.',
  ),
  node(
    'search-validation',
    260,
    300,
    'Search Request Validation',
    'Empty-query guard',
    'deterministic',
    'Boş sorgu 400 ile reddedilir. Workspace varsayılanı uygulanır ve limit planlama aşamasına taşınır.',
  ),
  node(
    'search-analysis',
    520,
    300,
    'Arama niyeti analizi',
    'Normalize + niyet + filtre',
    'local-llm',
    'Chat ile aynı güvenli query analyzer kullanılır: açık tarihin belge tarihi mi içerik olayı mı hedeflediği ayrılır, deterministik filtreler korunur ve model çıktısı izinli alan/aday listesiyle doğrulanır.',
    undefined,
    'queryAnalyzerModel',
  ),
  node(
    'search-plan',
    780,
    300,
    'Document Scope Planning',
    'Allowed document set',
    'deterministic',
    "Metadata/entity filtreleri önce belge ID kümesine çözülür. Bu küme bütün arama retriever'larına sınır olur.",
  ),
  node(
    'search-mode',
    1040,
    300,
    'Search Strategy',
    'Endpoint and query type',
    'decision',
    'Entity endpoint doğrudan varlık eşleşmesini; semantic endpoint vektör benzerliğini; hybrid endpoint iki sinyali birlikte kullanır.',
  ),
  node(
    'entity-search',
    1300,
    90,
    'Entity Resolution Search',
    'Alias, trigram and mention',
    'deterministic',
    "Canonical entity, alias, metin içi eşleşme ve trigram similarity ile aranır. En güçlü entity'nin belge ve kanıt chunk'ları döner.",
  ),
  node(
    'semantic-embedding',
    1300,
    300,
    'Query Embedding Generation',
    'Selected embedding model',
    'storage',
    "Sorgu embedding modeline dönüştürülür. Boyut 1024 değilse istek reddedilir; yalnız seçili modelin embedding'leri kullanılır.",
    undefined,
    'embeddingModel',
  ),
  node(
    'vector-search',
    1560,
    300,
    'Vector Similarity Search',
    'pgvector cosine distance',
    'deterministic',
    "İndeksli ve embedding'i hazır chunk'larda cosine benzerliği çalışır. Metadata filtreleri SQL seviyesinde uygulanır.",
  ),
  node(
    'lexical-search',
    1300,
    530,
    'Lexical & Anchor Search',
    'Full-text and numeric anchors',
    'deterministic',
    'Tam metin araması çalışır. Açık tarih için sayısal, Türkçe ve İngilizce yazım varyantları; pafta/ada/parsel gibi açık kimlikler için de deterministik anchor eşleşmeleri ayrıca sonuçlara eklenir.',
  ),
  node(
    'hybrid-decision',
    1820,
    300,
    'Fuse Retrieval Results?',
    'Combine multiple signals',
    'decision',
    "Hybrid arama istenirse lexical ve semantic adaylar birleştirilir; tekil endpoint'ler kendi sonuçlarıyla devam eder.",
  ),
  node(
    'rrf',
    2080,
    430,
    'Hybrid Rank Fusion (RRF)',
    'Merge ranked candidates',
    'deterministic',
    "Her retriever içindeki tekrarlar önce tekilleştirilir; aynı chunk farklı retriever'larda görünürse rank katkıları reciprocal-rank fusion ile birleştirilir.",
  ),
  node(
    'search-results',
    2340,
    300,
    'Return Search Results',
    'Sources, scores and snippets',
    'output',
    "UI; sonuçları, kaynak snippet'lerini, query analysis ve execution plan bilgisini gösterir. Chat bu veriyi ayrı RAG akışında yeniden kullanır.",
  ),
  node(
    'read-scope',
    780,
    520,
    'READ metadata scope',
    'documents, fields and values',
    'storage',
    'Planner, `documents`, `workspace_fields`, `document_field_values` ve gerekirse `entities` üzerinden SELECT/JOIN ile izinli document ID kümesini okur.',
  ),
  node(
    'read-entities',
    1560,
    90,
    'READ entity evidence',
    'entities and bridge tables',
    'storage',
    "Entity arama; `entities`, `entity_aliases`, `document_entities` ve `chunk_entities` tablolarını JOIN ederek canonical eşleşme, alias ve kanıt snippet'ini okur.",
  ),
  node(
    'read-chunks',
    1560,
    520,
    'READ retrieval chunks',
    'document_chunks and documents',
    'storage',
    'Lexical arama normalized chunk içeriğini (tarih varyantları ve sayısal anchorlar dahil); semantic arama `document_chunks.embedding` vektörünü ve `documents` durum/model filtresini okur.',
  ),
];

const searchEdges = workflowEdges([
  ['search-query', 'search-validation'],
  ['search-validation', 'search-analysis'],
  ['search-analysis', 'search-plan'],
  ['search-plan', 'read-scope', 'SELECT / JOIN'],
  ['read-scope', 'search-mode'],
  ['search-mode', 'entity-search', 'Entity'],
  ['search-mode', 'semantic-embedding', 'Semantic / hybrid'],
  ['semantic-embedding', 'vector-search'],
  ['search-mode', 'lexical-search', 'Hybrid'],
  ['entity-search', 'read-entities', 'SELECT / JOIN'],
  ['read-entities', 'search-results'],
  ['vector-search', 'read-chunks', 'SELECT / vector'],
  ['lexical-search', 'read-chunks', 'SELECT / text'],
  ['read-chunks', 'hybrid-decision'],
  ['hybrid-decision', 'search-results', 'Tekil sonuç'],
  ['hybrid-decision', 'rrf', 'Hybrid'],
  ['rrf', 'search-results'],
]);

const convertNodes: WorkflowNode[] = [
  node(
    'word-file',
    0,
    300,
    'DOCX Source File',
    'DOCX upload',
    'input',
    'Convert ekranı yalnız .docx kabul eder. Dosya conversion workspace içindeki inbox veya seçili çalışma alanına gönderilir.',
  ),
  node(
    'docx-check',
    260,
    300,
    'DOCX Validation',
    'Only .docx accepted',
    'deterministic',
    'Dosya uzantısı .docx değilse istek 400 ile reddedilir.',
  ),
  node(
    'conversion-storage',
    520,
    300,
    'Persist Source Document',
    'SHA-256 based name',
    'storage',
    "Orijinal Word dosyası, güvenli slug ve içerik hash'i ile _sources dizinine kopyalanır; çakışmasız Markdown adı oluşturulur.",
  ),
  node(
    'pandoc',
    780,
    300,
    'Pandoc Conversion',
    'DOCX to GitHub Markdown',
    'deterministic',
    'Pandoc GFM/pipe table formatında Markdown üretir ve gömülü medyayı ayrı assets klasörüne çıkarır. Pandoc yoksa 503, dönüşüm hatasında 422 döner.',
  ),
  node(
    'markdown-review',
    1040,
    300,
    'Markdown Review & Split',
    'Preview, edit and split',
    'deterministic',
    'Kullanıcı Markdown önizlemesini inceleyebilir, kaynağı mantıksal belgelere bölebilir veya dosyayı silebilir.',
  ),
  node(
    'yaml-decision',
    1300,
    300,
    'Generate YAML Metadata?',
    'User-triggered action',
    'decision',
    'YAML metadata kullanıcı isterse üretilir. Aynı dosyada model ya da metin düzeltmesi sonrası tekrar çalıştırılabilir.',
  ),
  node(
    'metadata-context',
    1560,
    100,
    'Load Metadata Context',
    'Registry-derived prompt and schema',
    'deterministic',
    'Çalışma alanının YAML promptu ve kayıtlı metadata alanları yüklenir. Sistem anahtarları modelin değiştirmesine kapalıdır.',
  ),
  node(
    'metadata-llm',
    1560,
    430,
    'YAML metadata üretimi',
    'Parçalı yapılandırılmış JSON',
    'local-llm',
    'Uzun belge parçalara ayrılarak seçili metadata modeline gönderilir. Sadece görünür bilgilerden JSON üretilir; temizlenir, birleştirilir ve alan kataloğuna kaydedilir.',
    undefined,
    'metadataLlmModel',
  ),
  node(
    'yaml-validation',
    1820,
    430,
    'Validate & Write YAML',
    'Character, field and value checks',
    'safety',
    'Geçersiz kontrol karakteri ve bozulmuş U+FFFD içeren metadata reddedilir. Güvenli JSON YAML frontmatter olarak yazılır.',
  ),
  node(
    'converted-ready',
    2080,
    300,
    'Ready for Ingestion',
    'Transfer to upload queue',
    'output',
    'Dönüştürülmüş Markdown, Upload ekranındaki kuyrukta görünür; ardından dosya yükleme ve indeksleme akışına girer.',
  ),
];

const convertEdges = workflowEdges([
  ['word-file', 'docx-check'],
  ['docx-check', 'conversion-storage'],
  ['conversion-storage', 'pandoc'],
  ['pandoc', 'markdown-review'],
  ['markdown-review', 'yaml-decision'],
  ['yaml-decision', 'converted-ready', 'Hayır'],
  ['yaml-decision', 'metadata-context', 'Evet'],
  ['metadata-context', 'metadata-llm'],
  ['metadata-llm', 'yaml-validation'],
  ['yaml-validation', 'converted-ready'],
]);

const legacyDatabaseNodes: WorkflowNode[] = [
  node(
    'ingestion-write',
    0,
    220,
    'Indexing Write Path',
    'Upload and reindex transactions',
    'input',
    'Dosya yükleme ve indeksleme akışları bu yolu kullanır. Her işlem workspace sınırında yürür; belge yeniden indekslenirse türetilmiş kayıtlar yeniden oluşturulur.',
  ),
  node(
    'workspace-table',
    270,
    70,
    'workspaces',
    'Archive boundary',
    'storage',
    "Her belge, alan, sohbet ve telemetry kaydı bir workspace'e bağlıdır. `workspace_id` veri izolasyonunun ana sınırıdır.",
  ),
  node(
    'documents-table',
    270,
    250,
    'documents',
    'Source content and lifecycle',
    'storage',
    'Markdown içerik, normalized content, frontmatter, hash, storage yolları, embedding modeli ve `UPLOADED → INDEXING → INDEXED` durumu burada tutulur.',
  ),
  node(
    'field-schema',
    540,
    70,
    'workspace_fields',
    'Dynamic metadata schema',
    'storage',
    "Çalışma alanına özgü alan tanımı: key, value type, filterable, searchable, entity-enabled ve alias'lar. İndeksleme sırasında yeni metadata alanları kaydedilebilir.",
  ),
  node(
    'chunks-table',
    540,
    250,
    'document_chunks',
    'Searchable text units',
    'storage',
    'Başlık, chunk index, içerik, normalize içerik, content hash, token sayısı ve 1024 boyutlu embedding burada saklanır.',
  ),
  node(
    'field-values',
    810,
    70,
    'document_field_values',
    'Typed metadata values',
    'storage',
    'Bir belgenin her metadata değeri text/date/number/boolean sütunlarına ayrılarak yazılır. Rule-based filtreler bu tabloyu kullanır.',
  ),
  node(
    'entities-table',
    810,
    250,
    'entities',
    'Canonical values',
    'storage',
    'Varlıklar `workspace_fields` altındaki canonical ve normalized değer olarak upsert edilir; aynı normalized değer aynı alan içinde tekildir.',
  ),
  node(
    'entity-aliases',
    1080,
    70,
    'entity_aliases',
    'Alternate spellings',
    'storage',
    "FRONTMATTER, REGEX, LLM, USER veya IMPORT kaynaklı alias'lar entity'ye bağlanır; alias aramasının temelidir.",
  ),
  node(
    'document-entities',
    1080,
    250,
    'document_entities',
    'Document ↔ entity bridge',
    'storage',
    "Bir varlığın belgede kaç kez geçtiği, en yoğun chunk ve kanıt snippet'i ile birlikte saklanır.",
  ),
  node(
    'chunk-entities',
    1350,
    250,
    'chunk_entities',
    'Chunk ↔ entity bridge',
    'storage',
    "Her entity mention için chunk seviyesinde kanıt, offset ve güven bilgisi saklanır; entity sonuçlarının en iyi snippet'i buradan seçilir.",
  ),
  node(
    'relationships-table',
    1350,
    70,
    'relationships',
    'Entity graph edges',
    'storage',
    'Kaynak/target entity, ilişki türü, kanıt ve origin bilgisiyle belge veya chunk bağlamına ait ilişkiyi temsil eder.',
  ),
  node(
    'property-table',
    1620,
    70,
    'property_references',
    'Parcel and property facts',
    'storage',
    'Yer, pafta, ada ve parsel gibi mülkiyet referansları normalized key ve kanıtla yazılır; sayısal anchor sorgularına hizmet eder.',
  ),
  node(
    'query-read',
    1620,
    350,
    'Search & Chat Read Path',
    'Scoped SELECT, JOIN and vector lookup',
    'input',
    "Sorgu planner'ı önce workspace ve metadata sınırını çözer; ardından seçilen arama stratejisi bu tablolardan kanıt okur.",
  ),
  node(
    'read-filter',
    1890,
    170,
    'Metadata Scope Query',
    'documents + field values + entities',
    'deterministic',
    '`documents`, `document_field_values`, `workspace_fields`, `entities` ve bridge tabloları JOIN edilerek izinli document ID kümesi çıkarılır.',
  ),
  node(
    'read-vector',
    1890,
    370,
    'Vector & Lexical Retrieval',
    'document_chunks and pgvector',
    'deterministic',
    'Semantic arama `document_chunks.embedding` üzerinde cosine distance kullanır; lexical arama normalized content ve sayısal anchor eşleşmelerini kullanır.',
  ),
  node(
    'result-evidence',
    2160,
    270,
    'Evidence for Search / Chat',
    'Chunks, entities, sources',
    'output',
    'Arama ekranına sonuçlar; Chat RAG akışına ise kaynak snippet, entity kanıtı ve seçilmiş chunk bağlamı döner.',
  ),
  node(
    'chat-write',
    2160,
    70,
    'Chat Persistence',
    'chat_sessions, chat_messages, query_executions',
    'storage',
    "Doğrulanmış soru/cevap, kaynak JSON'u ve execution plan telemetry'si ayrı sohbet ve telemetry tablolarına yazılır.",
  ),
];

const legacyDatabaseEdges = workflowEdges([
  ['ingestion-write', 'workspace-table', 'workspace lookup'],
  ['ingestion-write', 'documents-table', 'INSERT / UPSERT'],
  ['workspace-table', 'documents-table', '1 → N'],
  ['workspace-table', 'field-schema', '1 → N'],
  ['documents-table', 'chunks-table', 'INSERT'],
  ['documents-table', 'field-values', 'INSERT'],
  ['field-schema', 'field-values', 'field_id'],
  ['field-schema', 'entities-table', 'field_id'],
  ['entities-table', 'entity-aliases', '1 → N'],
  ['documents-table', 'document-entities', 'document_id'],
  ['entities-table', 'document-entities', 'entity_id'],
  ['chunks-table', 'chunk-entities', 'chunk_id'],
  ['entities-table', 'chunk-entities', 'entity_id'],
  ['workspace-table', 'relationships-table', 'workspace_id'],
  ['entities-table', 'relationships-table', 'source / target'],
  ['documents-table', 'property-table', 'document_id'],
  ['query-read', 'read-filter', 'SELECT / JOIN'],
  ['query-read', 'read-vector', 'SELECT / vector'],
  ['documents-table', 'read-filter'],
  ['field-values', 'read-filter'],
  ['entities-table', 'read-filter'],
  ['chunks-table', 'read-vector'],
  ['chunk-entities', 'result-evidence'],
  ['document-entities', 'result-evidence'],
  ['read-filter', 'result-evidence'],
  ['read-vector', 'result-evidence'],
  ['result-evidence', 'chat-write', 'answer metadata'],
]);

const databaseNodes: WorkflowNode[] = [
  node(
    'claims-schema',
    1260,
    650,
    'claims',
    'Grounded claims and events',
    'storage',
    'Evidence-backed subject, predicate, entity-or-literal object, optional date/range, and source chunk.',
  ),
  node(
    'workspace-schema',
    0,
    480,
    'workspaces',
    'Workspace ownership root',
    'storage',
    'Her workspace; belge, alan, sohbet ve telemetry kayıtlarının mülkiyet sınırıdır.',
  ),
  node(
    'fields-schema',
    300,
    80,
    'workspace_fields',
    'Workspace metadata schema',
    'storage',
    'Bir workspace içindeki dinamik metadata alanlarının tanımıdır.',
  ),
  node(
    'documents-schema',
    300,
    400,
    'documents',
    'Workspace-scoped source document',
    'storage',
    'Bir Markdown belgesinin içerik, hash, dosya yolları, metadata, indeks durumu ve embedding modelini tutar.',
  ),
  node(
    'sessions-schema',
    300,
    800,
    'chat_sessions',
    'Workspace conversation',
    'storage',
    'Bir workspace içindeki sohbet oturumlarını tutar.',
  ),
  node(
    'telemetry-schema',
    300,
    1000,
    'query_executions',
    'Query plan telemetry',
    'storage',
    'Sorgu planı, strateji, satır tahminleri, süreler ve fallback bilgisini tutar.',
  ),
  node(
    'values-schema',
    620,
    80,
    'document_field_values',
    'Typed document metadata',
    'storage',
    'Belge ve workspace alanı arasındaki typed metadata değerleri için bridge tablodur.',
  ),
  node(
    'entities-schema',
    620,
    260,
    'entities',
    'Canonical field values',
    'storage',
    'Bir workspace field altındaki normalize edilmiş canonical varlık/değer kaydıdır.',
  ),
  node(
    'chunks-schema',
    620,
    500,
    'document_chunks',
    'Document text units',
    'storage',
    "Belgeye ait parçalar, normalized içerik, token sayısı ve pgvector embedding'i tutar.",
  ),
  node(
    'property-schema',
    620,
    680,
    'property_references',
    'Document property facts',
    'storage',
    'Belgeye ait yer, pafta, ada ve parsel referanslarını tutar.',
  ),
  node(
    'messages-schema',
    620,
    860,
    'chat_messages',
    'Session messages and sources',
    'storage',
    "Kullanıcı/asistan mesajlarını, query türünü ve kaynak JSON'unu tutar.",
  ),
  node(
    'aliases-schema',
    940,
    80,
    'entity_aliases',
    'Entity spelling variants',
    'storage',
    "Bir entity'nin farklı yazımları ve kaynak bilgisini tutar.",
  ),
  node(
    'document-entities-schema',
    940,
    300,
    'document_entities',
    'Document ↔ entity',
    'storage',
    'Belge ile entity arasındaki mention/kanıt ilişkisini tutar.',
  ),
  node(
    'chunk-entities-schema',
    940,
    520,
    'chunk_entities',
    'Chunk ↔ entity',
    'storage',
    'Chunk seviyesindeki entity mention ve kanıt ilişkisini tutar.',
  ),
  node(
    'relationships-schema',
    1260,
    410,
    'relationships',
    'Entity graph edge',
    'storage',
    'Source ve target entity arasında belge/chunk kaynaklı ilişkiyi tutar.',
  ),
];

const databaseEdges = workflowEdges([
  ['workspace-schema', 'claims-schema', 'workspace_id'],
  ['documents-schema', 'claims-schema', 'document_id'],
  ['chunks-schema', 'claims-schema', 'chunk_id'],
  ['entities-schema', 'claims-schema', 'subject / object'],
  ['workspace-schema', 'documents-schema', 'workspace_id'],
  ['workspace-schema', 'fields-schema', 'workspace_id'],
  ['workspace-schema', 'sessions-schema', 'workspace_id'],
  ['workspace-schema', 'telemetry-schema', 'workspace_id'],
  ['documents-schema', 'chunks-schema', 'document_id'],
  ['documents-schema', 'values-schema', 'document_id'],
  ['documents-schema', 'document-entities-schema', 'document_id'],
  ['documents-schema', 'property-schema', 'document_id'],
  ['fields-schema', 'values-schema', 'field_id'],
  ['fields-schema', 'entities-schema', 'field_id'],
  ['entities-schema', 'aliases-schema', 'entity_id'],
  ['entities-schema', 'document-entities-schema', 'entity_id'],
  ['chunks-schema', 'chunk-entities-schema', 'chunk_id'],
  ['entities-schema', 'chunk-entities-schema', 'entity_id'],
  [
    'entities-schema',
    'relationships-schema',
    'source_entity_id / target_entity_id',
  ],
  ['documents-schema', 'relationships-schema', 'document_id'],
  ['chunks-schema', 'relationships-schema', 'chunk_id'],
  ['sessions-schema', 'messages-schema', 'session_id'],
]);

function node(
  id: string,
  x: number,
  y: number,
  title: string,
  subtitle: string,
  kind: WorkflowNodeKind,
  detail: string,
  rules?: string[],
  modelKey?: WorkflowNodeData['modelKey'],
): WorkflowNode {
  return {
    id,
    type: 'workflow',
    position: { x, y },
    data: { nodeId: id, title, subtitle, kind, detail, rules, modelKey },
  };
}

function workflowEdges(items: Array<[string, string, string?]>): Edge[] {
  return items.map(([source, target, label]) => ({
    id: `${source}-${target}`,
    source,
    target,
    label,
    animated: true,
    style: { stroke: '#71839b', strokeWidth: 1.8 },
    labelStyle: { fill: '#4c566a', fontSize: 11, fontWeight: 700 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
  }));
}

type WorkflowLayoutGroup = {
  id: string;
  label: string;
  description: string;
  nodeIds: string[];
  position: { x: number; y: number };
};

function groupWorkflowNodes(
  nodes: WorkflowNode[],
  layoutGroups: WorkflowLayoutGroup[],
): WorkflowNode[] {
  const groupNodes: WorkflowNode[] = [];
  const childNodes: WorkflowNode[] = [];
  const assigned = new Set<string>();
  const horizontalScale = 1.25;

  for (const group of layoutGroups) {
    const members = group.nodeIds
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is WorkflowNode => Boolean(node));
    if (!members.length) continue;
    const minX = Math.min(...members.map((node) => node.position.x));
    const maxX = Math.max(...members.map((node) => node.position.x));
    const minY = Math.min(...members.map((node) => node.position.y));
    const maxY = Math.max(...members.map((node) => node.position.y));
    const padding = 34;
    const groupHeaderHeight = 72;
    const groupId = `workflow-group-${group.id}`;

    groupNodes.push({
      id: groupId,
      type: 'workflow-group',
      position: group.position,
      data: {
        nodeId: group.id,
        title: group.label,
        subtitle: group.description,
        kind: 'input',
        detail: '',
      },
      style: {
        width: (maxX - minX) * horizontalScale + 205 + padding * 2,
        height: maxY - minY + 82 + padding * 2 + groupHeaderHeight,
      },
      selectable: false,
      draggable: false,
      zIndex: -1,
    });
    childNodes.push(
      ...members.map((node) => ({
        ...node,
        parentId: groupId,
        extent: 'parent' as const,
        position: {
          x: (node.position.x - minX) * horizontalScale + padding,
          y: node.position.y - minY + padding + groupHeaderHeight,
        },
        data: { ...node.data, group: group.id, section: group.label },
      })),
    );
    members.forEach((node) => assigned.add(node.id));
  }

  return [
    ...groupNodes,
    ...childNodes,
    ...nodes.filter((node) => !assigned.has(node.id)),
  ];
}

const uploadNodesGrouped = groupWorkflowNodes(uploadNodes, [
  {
    id: 'upload-intake',
    label: 'Source Intake',
    description: 'File selection, validation, and conflict handling',
    nodeIds: ['file', 'upload-validation', 'conflict', 'reject'],
    position: { x: 0, y: 40 },
  },
  {
    id: 'upload-storage',
    label: 'Storage & Job Setup',
    description: 'Source persistence and indexing job creation',
    nodeIds: ['store', 'document-record', 'index-start'],
    position: { x: 1400, y: 90 },
  },
  {
    id: 'upload-processing',
    label: 'Document Processing',
    description:
      'Normalization, chunking, extraction, linking, and quality control',
    nodeIds: [
      'normalize-doc',
      'chunk',
      'ocr-correction',
      'extract',
      'llm-extract-decision',
      'llm-extract',
      'field-match',
      'alias',
      'quality',
    ],
    position: { x: 2500, y: 160 },
  },
  {
    id: 'upload-index',
    label: 'Search Index',
    description: 'Persisted index and embeddings',
    nodeIds: ['persist-index', 'embedding', 'vector-ready'],
    position: { x: 5250, y: 180 },
  },
  {
    id: 'upload-writes',
    label: 'Database Writes',
    description:
      'Documents, chunks, metadata, entities, claims, links, and vectors',
    nodeIds: [
      'write-document',
      'write-chunks',
      'write-fields',
      'write-entities',
      'write-links',
      'write-claims',
      'write-vectors',
    ],
    position: { x: 2500, y: 900 },
  },
]);

const searchNodesGrouped = groupWorkflowNodes(searchNodes, [
  {
    id: 'search-planning',
    label: 'Query Planning',
    description: 'Validation, analysis, scope, and strategy selection',
    nodeIds: [
      'search-query',
      'search-validation',
      'search-analysis',
      'search-plan',
      'read-scope',
      'search-mode',
    ],
    position: { x: 0, y: 40 },
  },
  {
    id: 'search-retrieval',
    label: 'Retrieval',
    description: 'Entity, vector, lexical, and hybrid retrieval',
    nodeIds: [
      'entity-search',
      'semantic-embedding',
      'vector-search',
      'lexical-search',
      'hybrid-decision',
      'rrf',
      'read-entities',
      'read-chunks',
    ],
    position: { x: 1700, y: 130 },
  },
  {
    id: 'search-output',
    label: 'Results',
    description: 'Sources, scores, snippets, and execution details',
    nodeIds: ['search-results'],
    position: { x: 3150, y: 220 },
  },
]);

const convertNodesGrouped = groupWorkflowNodes(convertNodes, [
  {
    id: 'convert-source',
    label: 'Source Conversion',
    description: 'DOCX validation, storage, conversion, and review',
    nodeIds: [
      'word-file',
      'docx-check',
      'conversion-storage',
      'pandoc',
      'markdown-review',
    ],
    position: { x: 0, y: 40 },
  },
  {
    id: 'convert-metadata',
    label: 'Metadata Enrichment',
    description: 'Optional YAML metadata generation and validation',
    nodeIds: [
      'yaml-decision',
      'metadata-context',
      'metadata-llm',
      'yaml-validation',
    ],
    position: { x: 1700, y: 120 },
  },
  {
    id: 'convert-output',
    label: 'Ingestion Handoff',
    description: 'Markdown ready for upload and indexing',
    nodeIds: ['converted-ready'],
    position: { x: 2800, y: 180 },
  },
]);

const databaseNodesGrouped = groupWorkflowNodes(databaseNodes, [
  {
    id: 'database-workspace',
    label: 'Workspace Scope',
    description: 'Workspace ownership and dynamic field definitions',
    nodeIds: ['workspace-schema', 'fields-schema'],
    position: { x: 0, y: 220 },
  },
  {
    id: 'database-documents',
    label: 'Document & Metadata',
    description: 'Documents, chunks, metadata values, and property facts',
    nodeIds: [
      'documents-schema',
      'chunks-schema',
      'values-schema',
      'property-schema',
    ],
    position: { x: 800, y: 80 },
  },
  {
    id: 'database-entities',
    label: 'Entity Graph & Claims',
    description:
      'Canonical entities, aliases, mentions, relationships, and grounded claims',
    nodeIds: [
      'entities-schema',
      'aliases-schema',
      'document-entities-schema',
      'chunk-entities-schema',
      'relationships-schema',
      'claims-schema',
    ],
    position: { x: 1650, y: 120 },
  },
  {
    id: 'database-chat',
    label: 'Chat & Telemetry',
    description: 'Sessions, messages, and query execution records',
    nodeIds: ['sessions-schema', 'messages-schema', 'telemetry-schema'],
    position: { x: 2950, y: 320 },
  },
]);

export function ArchitectureMap() {
  const { language } = useLanguage();
  const isEnglish = language === 'en';
  const [activeTab, setActiveTab] = useState<WorkflowTab>('chat');
  const [selectedId, setSelectedId] = useState('question');
  const [models, setModels] = useState<ModelSettings | null>(null);
  const baseWorkflow =
    activeTab === 'chat'
      ? { nodes: chatNodesGrouped, edges: chatEdges }
      : activeTab === 'upload'
        ? { nodes: uploadNodesGrouped, edges: uploadEdges }
        : activeTab === 'search'
          ? { nodes: searchNodesGrouped, edges: searchEdges }
          : activeTab === 'convert'
            ? { nodes: convertNodesGrouped, edges: convertEdges }
            : { nodes: databaseNodesGrouped, edges: databaseEdges };
  const workflow = useMemo(
    () => ({
      ...baseWorkflow,
      nodes: baseWorkflow.nodes.map((item) => {
        const modelKey = item.data.modelKey;
        if (!modelKey || modelKey === 'embeddingModel') return item;
        // The two reranking lanes are provider-bound: the clear-signal lane is
        // always local, while the ambiguity lane is always API-backed.
        if (item.data.nodeId === 'rerank' || item.data.nodeId === 'api-rerank')
          return item;
        const model = models?.[modelKey];
        const apiSelected =
          modelKey === 'llmModel'
            ? models?.llmProvider !== undefined &&
              models.llmProvider !== 'ollama'
            : typeof model === 'string' && /^(openai|anthropic)\//.test(model);
        const kind: WorkflowNodeKind = apiSelected ? 'api-llm' : 'local-llm';
        return { ...item, data: { ...item.data, kind } };
      }),
    }),
    [baseWorkflow.edges, baseWorkflow.nodes, models],
  );
  const selected = useMemo(
    () =>
      workflow.nodes.find((item) => item.id === selectedId) ??
      workflow.nodes[0],
    [selectedId, workflow.nodes],
  );

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/settings/models`);
        if (!response.ok) return;
        const settings = (await response.json()) as ModelSettings;
        if (!cancelled) setModels(settings);
      } catch {
        /* A diagram stays useful even while the API is unavailable. */
      }
    };
    void loadModels();
    window.addEventListener('knowledgeos:model-settings-changed', loadModels);
    return () => {
      cancelled = true;
      window.removeEventListener(
        'knowledgeos:model-settings-changed',
        loadModels,
      );
    };
  }, []);

  function chooseTab(tab: WorkflowTab) {
    setActiveTab(tab);
    setSelectedId(
      tab === 'chat'
        ? 'question'
        : tab === 'upload'
          ? 'file'
          : tab === 'search'
            ? 'search-query'
            : tab === 'convert'
              ? 'word-file'
              : 'workspace-schema',
    );
  }

  return (
    <section
      className="architecture-map"
      aria-label={isEnglish ? 'System workflows' : 'Sistem işlem akışları'}
    >
      <header className="architecture-map__header">
        <div>
          <p className="eyebrow">
            {isEnglish ? 'Living architecture' : 'Yaşayan mimari'}
          </p>
          <h1>{isEnglish ? 'Workflows' : 'İşlem akışları'}</h1>
          <p>
            {isEnglish
              ? 'Each tab shows the application’s actual decision points, LLM layers, and safety gates.'
              : 'Her tab, uygulamanın gerçek karar noktalarını, LLM katmanlarını ve güvenlik kapılarını gösterir.'}
          </p>
        </div>
      </header>
      <div
        className="workflow-tabs"
        role="tablist"
        aria-label={isEnglish ? 'Workflows' : 'İşlem akışları'}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'convert'}
          className={activeTab === 'convert' ? 'is-active' : ''}
          onClick={() => chooseTab('convert')}
        >
          <i className="pi pi-file-edit" />
          {isEnglish ? 'Conversion → Markdown' : 'Dönüştürme → Markdown'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chat'}
          className={activeTab === 'chat' ? 'is-active' : ''}
          onClick={() => chooseTab('chat')}
        >
          <i className="pi pi-comments" />
          {isEnglish ? 'Chat: question → answer' : 'Sohbet: soru → cevap'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'upload'}
          className={activeTab === 'upload' ? 'is-active' : ''}
          onClick={() => chooseTab('upload')}
        >
          <i className="pi pi-upload" />
          {isEnglish ? 'Upload → index' : 'Dosya yükleme → indeks'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'search'}
          className={activeTab === 'search' ? 'is-active' : ''}
          onClick={() => chooseTab('search')}
        >
          <i className="pi pi-search" />
          {isEnglish ? 'Search: query → results' : 'Arama: sorgu → sonuç'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'database'}
          className={activeTab === 'database' ? 'is-active' : ''}
          onClick={() => chooseTab('database')}
        >
          <i className="pi pi-database" />
          {isEnglish ? 'Database schema' : 'Veritabanı şeması'}
        </button>
      </div>
      <div className="workflow-legend" aria-label="Katman açıklamaları">
        {(
          [
            'deterministic',
            'local-llm',
            'api-llm',
            'decision',
            'safety',
            'storage',
          ] as WorkflowNodeKind[]
        ).map((kind) => (
          <span key={kind} className={`workflow-legend__item is-${kind}`}>
            <i />
            {localizedNodeKindLabel(kind, language)}
          </span>
        ))}
      </div>
      <div className="architecture-map__layout">
        <div className="architecture-canvas workflow-canvas">
          <ReactFlow
            key={activeTab}
            nodes={workflow.nodes}
            edges={workflow.edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.1}
            maxZoom={1.5}
            onNodeClick={(_, current) => setSelectedId(current.id)}
          >
            <Background gap={18} size={1} color="rgba(76, 86, 106, 0.18)" />
            <MiniMap
              nodeColor={(current) =>
                current.id === selected.id ? '#5e81ac' : '#94a3b8'
              }
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="architecture-inspector workflow-inspector">
          <span>{isEnglish ? 'Selected step' : 'Seçili işlem'}</span>
          {selected.data.group ? (
            <p className="workflow-node-group-label">
              {localizedGroupCopy[selected.data.group]?.[language]?.title ??
                selected.data.section ??
                chatGroups.find((group) => group.id === selected.data.group)
                  ?.label}
            </p>
          ) : null}
          <p className={`workflow-node-type is-${selected.data.kind}`}>
            {localizedNodeKindLabel(selected.data.kind, language)}
          </p>
          <h2>{localizedNodeTitle(selected.data, language)}</h2>
          <p>{localizedNodeDetail(selected.data, language)}</p>
          {selected.data.modelKey ? (
            <div className="workflow-model">
              <span>{isEnglish ? 'Model in use' : 'Kullanılan model'}</span>
              <strong>
                {models?.[selected.data.modelKey] ||
                  (isEnglish
                    ? 'Loading model settings…'
                    : 'Model ayarı yükleniyor…')}
              </strong>
              <small>
                {selected.data.modelKey === 'embeddingModel'
                  ? `${models?.embeddingProvider ?? ''} ${isEnglish ? 'embedding provider' : 'embedding sağlayıcısı'}`
                  : selected.data.modelKey === 'fieldMatcherModel'
                    ? isEnglish
                      ? 'Field-matching embedding model'
                      : 'Alan eşleme embedding modeli'
                    : localizedNodeKindLabel(selected.data.kind, language)}
              </small>
              <Link className="architecture-open-link" href="/settings">
                {isEnglish ? 'Open model settings' : 'Model ayarlarını aç'}
                <i className="pi pi-arrow-up-right" />
              </Link>
            </div>
          ) : null}
          {selected.data.rules?.length ? (
            <ul>
              {selected.data.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          ) : null}
          {activeTab === 'chat' && selected.id === 'persist' ? (
            <Link className="architecture-open-link" href="/chat">
              <span>Sohbeti aç</span>
              <i className="pi pi-arrow-up-right" />
            </Link>
          ) : null}
          {activeTab === 'upload' &&
          ['file', 'index-start', 'vector-ready'].includes(selected.id) ? (
            <Link className="architecture-open-link" href="/upload">
              <span>Yükleme ekranını aç</span>
              <i className="pi pi-arrow-up-right" />
            </Link>
          ) : null}
          {activeTab === 'search' && selected.id === 'search-results' ? (
            <Link className="architecture-open-link" href="/search">
              <span>Arama ekranını aç</span>
              <i className="pi pi-arrow-up-right" />
            </Link>
          ) : null}
          {activeTab === 'convert' && selected.id === 'converted-ready' ? (
            <Link className="architecture-open-link" href="/convert">
              <span>Dönüştürme ekranını aç</span>
              <i className="pi pi-arrow-up-right" />
            </Link>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
