export const chatWorkflowStages = [
  {
    id: "received",
    lane: "chat",
    label: { tr: "Soru alındı", en: "Question received" },
    description: { tr: "İstek doğrulanıyor ve çalışma alanına bağlanıyor.", en: "The request is validated and attached to the workspace." }
  },
  {
    id: "classify",
    lane: "chat",
    label: { tr: "Sorgu sınıflandırma", en: "Query classification" },
    description: { tr: "Arama türü ve metadata filtreleri belirleniyor.", en: "Search strategy and metadata filters are selected." }
  },
  {
    id: "retrieve",
    lane: "retrieval",
    label: { tr: "Paralel hybrid retrieval", en: "Parallel hybrid retrieval" },
    description: { tr: "Entity, lexical ve semantic aramalar birlikte çalışıyor.", en: "Entity, lexical, and semantic retrieval run together." },
    branches: [
      { id: "entity", label: { tr: "Entity arama", en: "Entity search" } },
      { id: "lexical", label: { tr: "Lexical arama", en: "Lexical search" } },
      { id: "semantic", label: { tr: "Semantic arama", en: "Semantic search" } }
    ]
  },
  {
    id: "fuse",
    lane: "retrieval",
    label: { tr: "RRF birleştirme", en: "RRF fusion" },
    description: { tr: "Farklı arama sonuçları tek aday listesinde birleştiriliyor.", en: "Retriever results are merged into one candidate list." }
  },
  {
    id: "rerank",
    lane: "retrieval",
    label: { tr: "Yeniden sıralama", en: "Reranking" },
    description: { tr: "En güçlü kanıtlar soruya göre öne çıkarılıyor.", en: "The strongest evidence is prioritized for the question." }
  },
  {
    id: "context",
    lane: "chat",
    label: { tr: "Context oluşturma", en: "Context building" },
    description: { tr: "Komşu parçalar ekleniyor ve token bütçesine sığdırılıyor.", en: "Neighboring chunks are added and fitted to the token budget." }
  },
  {
    id: "generate",
    lane: "model",
    label: { tr: "LLM yanıt üretimi", en: "LLM answer generation" },
    description: { tr: "Seçilen kaynaklardan taslak yanıt üretiliyor.", en: "A draft answer is generated from the selected evidence." }
  },
  {
    id: "validate",
    lane: "control",
    label: { tr: "Kaynak doğrulama", en: "Evidence validation" },
    description: { tr: "Citation, sayısal değerler ve groundedness kontrol ediliyor.", en: "Citations, numeric values, and groundedness are checked." }
  },
  {
    id: "persist",
    lane: "control",
    label: { tr: "Geçmişe kaydetme", en: "Saving history" },
    description: { tr: "Doğrulanmış soru ve yanıt chat geçmişine kaydediliyor.", en: "The verified question and answer are saved to chat history." }
  },
  {
    id: "deliver",
    lane: "chat",
    label: { tr: "Yanıtı gönderme", en: "Delivering answer" },
    description: { tr: "Doğrulanmış yanıt kullanıcıya aktarılıyor.", en: "The verified answer is delivered to the user." }
  }
] as const;

export type ChatWorkflowStageId = (typeof chatWorkflowStages)[number]["id"];

export type ChatProgress = {
  stage: ChatWorkflowStageId;
  message?: string;
  detail?: string;
};

