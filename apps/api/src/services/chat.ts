import { classifyQuery } from "@knowledgeos/search";
import type { QueryType } from "@knowledgeos/shared";
import type { ApiConfig } from "../config/env.js";
import { getLlmProvider } from "./ai-providers.js";
import { getSemanticContext, searchSemanticDocuments, type SemanticContextChunk } from "./semantic-search.js";
import type { EntitySearchResult } from "./search.js";

export type ChatResponse = {
  queryType: QueryType;
  answer: string;
  matchedEntity: EntitySearchResult["matchedEntity"];
  matchedAliases: EntitySearchResult["matchedAliases"];
  sources: Array<{
    documentName: string;
    title: string;
    evidenceSnippet: string;
    matchedAliases?: string[];
    sourceType?: "ENTITY" | "SEMANTIC";
    score?: number;
  }>;
};

export async function answerChat(
  config: ApiConfig,
  input: { workspaceSlug: string; message: string }
): Promise<ChatResponse> {
  const queryType = classifyQuery(input.message);
  const result = await searchSemanticDocuments(config, {
    workspaceSlug: input.workspaceSlug,
    query: input.message
  });
  const sources = result.sources.map((source) => ({ ...source, sourceType: "SEMANTIC" as const }));

  if (result.results.length === 0) {
    return {
      queryType,
      answer: "Bu soruyu yanıtlamak için çalışma alanında yeterince ilgili kaynak bulamadım.",
      matchedEntity: null,
      matchedAliases: [],
      sources
    };
  }

  const context = await getSemanticContext(config, input.workspaceSlug, result.results);
  const answer = await getLlmProvider(config, "answer").generate(buildRagPrompt(input.message, context));

  return {
    queryType,
    answer: answer.trim() || "Model kaynaklara dayalı bir yanıt üretemedi.",
    matchedEntity: null,
    matchedAliases: [],
    sources
  };
}

function buildRagPrompt(question: string, chunks: SemanticContextChunk[]) {
  const context = chunks.map((chunk, index) => {
    const source = `[${index + 1}] Belge: ${chunk.documentName}; Başlık: ${chunk.title}; Bölüm: ${chunk.heading ?? "-"}; Parça: ${chunk.chunkIndex}`;
    return `${source}\n${chunk.content}`;
  }).join("\n\n---\n\n");

  return `Sen, kullanıcının çalışma alanındaki belgelerle çalışan bir araştırma asistanısın. Soruyu yalnızca aşağıdaki kaynak parçalarına dayanarak yanıtla. Kaynaklarda olmayan bilgiyi uydurma. Kaynaklar yetersizse bunu açıkça söyle. Yanıtı kullanıcının sorusunun dilinde, açık ve doğrudan yaz. Her doğrulanabilir iddiadan sonra ilgili kaynak numarasını [1] biçiminde belirt. Kaynak numarası olmayan iddia yazma.\n\nKullanıcının sorusu:\n${question}\n\nKaynak parçaları:\n${context}`;
}
