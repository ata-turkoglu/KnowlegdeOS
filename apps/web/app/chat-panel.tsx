"use client";

import { useState } from "react";
import { AButton, AInput } from "../components/ui";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type ChatSource = {
  documentName: string;
  title: string;
  evidenceSnippet: string;
  matchedAliases?: string[];
  sourceType?: "ENTITY" | "SEMANTIC";
  score?: number;
};

type ChatResponse = {
  queryType: string;
  answer: string;
  matchedEntity: {
    canonicalValue: string;
  } | null;
  matchedAliases: Array<{
    alias: string;
  }>;
  sources: ChatSource[];
};

export function ChatPanel() {
  const { workspaceSlug } = useWorkspace();
  const [message, setMessage] = useState("Ali Cobanoglu gecen belgeleri ozetle");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function sendMessage() {
    if (!message.trim()) {
      setStatus("Soru bos olamaz.");
      return;
    }

    setIsSending(true);
    setStatus("");

    const result = await fetch(`${apiBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        workspaceSlug,
        message
      })
    });
    const body = await result.json();

    setIsSending(false);

    if (!result.ok) {
      setStatus(body.error ?? "Chat istegi basarisiz.");
      return;
    }

    setResponse(body);
  }

  return (
    <section className="panel chat-panel">
      <div>
        <p className="eyebrow">Chat</p>
        <h3>Kaynakli cevap</h3>
      </div>

      <div className="chat-form">
        <label>
          Soru
          <AInput value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        <AButton type="button" onClick={sendMessage} disabled={isSending}>
          {isSending ? "Soruluyor..." : "Sor"}
        </AButton>
      </div>

      {status ? <p className="form-message">{status}</p> : null}

      {response ? (
        <div className="chat-result">
          <div className="result-strip">
            <span>Query Type</span>
            <strong>{response.queryType}</strong>
          </div>
          <p className="answer">{response.answer}</p>
          <div className="result-strip">
            <span>Matched Entity</span>
            <strong>{response.matchedEntity?.canonicalValue ?? "Yok"}</strong>
          </div>

          {response.matchedAliases.length > 0 ? (
            <div className="alias-list">
              {response.matchedAliases.map((alias) => (
                <span key={alias.alias}>{alias.alias}</span>
              ))}
            </div>
          ) : null}

          <div className="chat-source-list">
            {response.sources.map((source, index) => (
              <article
                key={`${source.documentName}-${source.sourceType ?? "source"}-${index}`}
              >
                <div className="chat-source-heading">
                  <div>
                    <strong>{source.documentName}</strong>
                    <span>{source.title}</span>
                  </div>
                  <div className="document-stats">
                    {source.sourceType ? <span>{source.sourceType}</span> : null}
                    {typeof source.score === "number" ? (
                      <span>{source.score.toFixed(3)}</span>
                    ) : null}
                  </div>
                </div>

                {source.matchedAliases && source.matchedAliases.length > 0 ? (
                  <div className="alias-list">
                    {source.matchedAliases.map((alias) => (
                      <span key={alias}>{alias}</span>
                    ))}
                  </div>
                ) : null}

                <p>{source.evidenceSnippet}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
