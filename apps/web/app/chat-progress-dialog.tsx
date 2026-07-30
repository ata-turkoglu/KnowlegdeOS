"use client";

import { chatWorkflowStages, type ChatProgress, type ChatWorkflowStageId } from "@knowledgeos/shared";
import { useEffect, useRef } from "react";
import { ADialog } from "../components/ui";
import { useLanguage } from "./language-context";

type ChatProgressDialogProps = {
  visible: boolean;
  onHide: () => void;
  events: ChatProgress[];
  complete: boolean;
};

const laneLabels = {
  chat: { tr: "Chat akışı", en: "Chat flow" },
  retrieval: { tr: "Arama ve bilgi tabanı", en: "Retrieval and knowledge base" },
  model: { tr: "Model", en: "Model" },
  control: { tr: "Kontrol", en: "Control" }
} as const;

function tokenUsageLabel(usage: ChatProgress["usage"], locale: "tr" | "en") {
  if (!usage) return null;
  const format = (value: number | undefined) => typeof value === "number" ? value.toLocaleString(locale === "tr" ? "tr-TR" : "en-US") : "—";
  const source = usage.source === "provider"
    ? (locale === "tr" ? "sağlayıcı" : "provider")
    : (locale === "tr" ? "tahmini" : "estimated");
  return locale === "tr"
    ? `${format(usage.inputTokens)} giriş · ${format(usage.outputTokens)} çıkış · ${format(usage.totalTokens)} toplam token (${source})`
    : `${format(usage.inputTokens)} input · ${format(usage.outputTokens)} output · ${format(usage.totalTokens)} total tokens (${source})`;
}

export function ChatProgressDialog({ visible, onHide, events, complete }: ChatProgressDialogProps) {
  const { language } = useLanguage();
  const locale = language === "en" ? "en" : "tr";
  const current = events.at(-1);
  const visited = new Set(events.map((event) => event.stage));
  const currentDefinition = chatWorkflowStages.find((stage) => stage.id === current?.stage);
  const currentIndex = events.length - 1;
  const flowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeStep = flowRef.current?.querySelector(".chat-workflow__step.is-active");
    activeStep?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [current?.stage]);

  function lastEventIndex(stageId: ChatWorkflowStageId) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.stage === stageId) return index;
    }
    return -1;
  }

  function stateFor(stageId: ChatWorkflowStageId) {
    if (complete && stageId === "deliver") return "completed";
    if (current?.stage === stageId) return "active";
    if (!visited.has(stageId)) return "idle";
    const lastStageIndex = lastEventIndex(stageId);
    return lastStageIndex < currentIndex ? "completed" : "idle";
  }

  return (
    <ADialog
      visible={visible}
      onHide={onHide}
      modal={false}
      draggable={false}
      className="chat-progress-dialog"
      header={locale === "en" ? "Live RAG flow" : "Canlı RAG akışı"}
      style={{ width: "min(1180px, calc(100vw - 28px))" }}
    >
      <div className="chat-progress-summary" aria-live="polite">
        <span className={`chat-progress-summary__pulse${complete ? " is-complete" : ""}`} aria-hidden="true" />
        <div>
          <strong>
            {complete
              ? (locale === "en" ? "Answer delivered" : "Yanıt gönderildi")
              : (currentDefinition?.label[locale] ?? (locale === "en" ? "Preparing request" : "İstek hazırlanıyor"))}
          </strong>
          <p>{current?.detail ?? current?.message ?? currentDefinition?.description[locale]}</p>
          {tokenUsageLabel(current?.usage, locale) ? <small className="chat-progress-summary__usage">{tokenUsageLabel(current?.usage, locale)}</small> : null}
        </div>
      </div>

      <div className="chat-workflow-scroll" ref={flowRef}>
        <div className="chat-workflow" role="list" aria-label={locale === "en" ? "Chat processing stages" : "Chat işlem aşamaları"}>
          {chatWorkflowStages.map((stage, index) => {
          const state = stateFor(stage.id);
          return (
            <div className="chat-workflow__step-wrap" key={stage.id}>
              <article
                role="listitem"
                className={`chat-workflow__step is-${state} lane-${stage.lane}`}
                aria-current={state === "active" ? "step" : undefined}
              >
                <div className="chat-workflow__lane">{laneLabels[stage.lane][locale]}</div>
                <div className="chat-workflow__step-title">
                  <span aria-hidden="true">
                    {state === "completed" ? <i className="pi pi-check" /> : index + 1}
                  </span>
                  <strong>{stage.label[locale]}</strong>
                </div>
                {"branches" in stage ? (
                  <div className="chat-workflow__branches">
                    {stage.branches.map((branch) => <span key={branch.id}>{branch.label[locale]}</span>)}
                  </div>
                ) : (
                  <p>{stage.description[locale]}</p>
                )}
                {state === "active" && current?.stage === stage.id && tokenUsageLabel(current.usage, locale) ? <small className="chat-workflow__usage">{tokenUsageLabel(current.usage, locale)}</small> : null}
              </article>
              {index < chatWorkflowStages.length - 1 ? <span className={`chat-workflow__arrow is-${state}`} aria-hidden="true"><i className="pi pi-arrow-right" /></span> : null}
            </div>
          );
          })}
        </div>
      </div>
      <p className="chat-progress-dialog__note">
        {locale === "en"
          ? "This view is driven by real server events; stages that are skipped remain inactive."
          : "Bu görünüm gerçek sunucu event’leriyle ilerler; atlanan aşamalar pasif kalır."}
      </p>
    </ADialog>
  );
}
