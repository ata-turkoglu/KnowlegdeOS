export const chatWorkflowStages = [
  { id: "received", lane: "chat", label: { tr: "İstek doğrulama", en: "Request validation" }, description: { tr: "Mesaj, çalışma alanı ve oturum bilgisi doğrulanıyor.", en: "Message, workspace, and session data are validated." } },
  { id: "history", lane: "chat", label: { tr: "Sohbet geçmişi", en: "Conversation history" }, description: { tr: "Varsa önceki oturum okunuyor; uzun geçmiş özetleniyor.", en: "The prior session is read; long history is summarized." } },
  { id: "normalize", lane: "model", label: { tr: "Sorgu normalleştirme", en: "Query normalization" }, description: { tr: "Yerel LLM ile güvenli yazım/OCR varyantları hazırlanıyor.", en: "Safe spelling and OCR variants are prepared by the local LLM." } },
  { id: "classify", lane: "model", label: { tr: "Niyet ve filtre analizi", en: "Intent and filter analysis" }, description: { tr: "Niyet, entity adayları ve metadata filtreleri çıkarılıyor.", en: "Intent, entity candidates, and metadata filters are extracted." } },
  { id: "plan", lane: "control", label: { tr: "Yürütme planı", en: "Execution plan" }, description: { tr: "Rule-based sorgu planı, maliyet ve kullanılabilir arama yetenekleri belirleniyor.", en: "The rule-based query plan, cost, and available retrieval capabilities are determined." } },
  { id: "database", lane: "retrieval", label: { tr: "Doğrudan veritabanı yanıtı", en: "Direct database answer" }, description: { tr: "Sayma, gruplama veya timeline yanıtı LLM çağrılmadan SQL ile oluşturuluyor.", en: "A count, grouping, or timeline answer is produced with SQL without calling an LLM." } },
  { id: "retrieve", lane: "retrieval", label: { tr: "Paralel retrieval", en: "Parallel retrieval" }, description: { tr: "Entity, lexical ve semantic aramalar paralel çalışıyor.", en: "Entity, lexical, and semantic retrieval run in parallel." }, branches: [{ id: "entity", label: { tr: "Entity arama", en: "Entity search" } }, { id: "lexical", label: { tr: "Lexical arama", en: "Lexical search" } }, { id: "semantic", label: { tr: "Semantic arama", en: "Semantic search" } }] },
  { id: "fuse", lane: "retrieval", label: { tr: "Sonuç birleştirme", en: "Result fusion" }, description: { tr: "Retriever sonuçları RRF ile ortak aday listesine dönüştürülüyor.", en: "Retriever results are merged into a shared candidate list with RRF." } },
  { id: "rerank", lane: "model", label: { tr: "Yeniden sıralama", en: "Reranking" }, description: { tr: "Açık sayısal kimlik yoksa yerel LLM en güçlü kanıtları sıralıyor.", en: "When no explicit numeric anchor exists, the local LLM ranks the strongest evidence." } },
  { id: "context", lane: "chat", label: { tr: "Bağlam bütçesi", en: "Context budgeting" }, description: { tr: "Komşu parçalar ekleniyor ve token bütçesine sığdırılıyor.", en: "Neighbor chunks are added and fitted to the token budget." } },
  { id: "evidence", lane: "model", label: { tr: "Kanıt alıntısı seçimi", en: "Evidence quote selection" }, description: { tr: "Uzun kaynaklardan birebir doğrulanabilir alıntılar seçiliyor.", en: "Verifiable verbatim quotes are selected from long source context." } },
  { id: "safety", lane: "control", label: { tr: "Kanıt güvenliği", en: "Evidence sanitization" }, description: { tr: "Kaynak talimatları ve hassas bilgiler temizleniyor.", en: "Source instructions and sensitive data are sanitized." } },
  { id: "conflict", lane: "model", label: { tr: "Kaynak çelişkisi kontrolü", en: "Evidence conflict check" }, description: { tr: "Kaynaklar arasındaki açık tarih, tutar veya isim çelişkileri aranıyor.", en: "Explicit date, amount, or name conflicts across sources are checked." } },
  { id: "generate", lane: "model", label: { tr: "Kaynaklı cevap üretimi", en: "Grounded answer generation" }, description: { tr: "Seçilen güvenli kanıtlardan taslak yanıt üretiliyor.", en: "A draft answer is generated from the selected safe evidence." } },
  { id: "validate", lane: "control", label: { tr: "Citation doğrulama", en: "Citation validation" }, description: { tr: "Citation, sayısal değerler ve groundedness kontrol ediliyor.", en: "Citations, numeric values, and groundedness are checked." } },
  { id: "persist", lane: "control", label: { tr: "Sohbeti kaydetme", en: "Chat persistence" }, description: { tr: "Doğrulanmış soru, yanıt, kaynaklar ve telemetry kaydediliyor.", en: "The verified question, answer, sources, and telemetry are saved." } },
  { id: "deliver", lane: "chat", label: { tr: "Yanıtı gönderme", en: "Answer delivery" }, description: { tr: "Doğrulanmış yanıt kullanıcıya aktarılıyor.", en: "The verified answer is delivered to the user." } }
] as const;

export type ChatWorkflowStageId = (typeof chatWorkflowStages)[number]["id"];

export type ChatProgress = {
  stage: ChatWorkflowStageId;
  message?: string;
  detail?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
    source: "provider" | "estimate";
  };
};
