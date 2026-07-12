"use client";

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ADialog, AButton, ATextarea } from "../components/ui";
import { useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

const apiBaseUrl = "http://127.0.0.1:4000";
const historyWidthStorageKey = "knowledgeos.chat-history-width";

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
  sources: ChatSource[];
  sessionId: string;
};

type ConversationItem =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; sources: ChatSource[]; queryType: string };

type ChatSession = {
  id: string;
  title: string;
  messages: ConversationItem[];
};

const suggestions = [
  "Bu çalışma alanındaki önemli başlıkları özetle",
  "Ali Cobanoglu geçen belgeleri özetle",
  "Belgelerdeki ortak temaları bul"
];

const englishSuggestions = [
  "Summarize the key topics in this workspace",
  "Summarize documents that mention Ali Cobanoglu",
  "Find common themes across the documents"
];

export function ChatPanel() {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [historyWidth, setHistoryWidth] = useState(250);
  const [resizeStart, setResizeStart] = useState<{ x: number; width: number } | null>(null);
  const [message, setMessage] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([{ id: `local:${crypto.randomUUID()}`, title: language === "en" ? "New chat" : "Yeni sohbet", messages: [] }]);
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0].id);
  const [status, setStatus] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<ChatSession | null>(null);
  const [isSending, setIsSending] = useState(false);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const conversation = activeSession.messages;

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(historyWidthStorageKey));
    if (Number.isFinite(savedWidth)) {
      setHistoryWidth(Math.min(360, Math.max(160, savedWidth)));
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;

    async function loadHistory() {
      try {
        const result = await fetch(`${apiBaseUrl}/api/chat/sessions?workspaceSlug=${encodeURIComponent(workspaceSlug)}`);
        if (!result.ok) return;
        const storedSessions = await result.json() as ChatSession[];
        const uniqueSessions = Array.from(
          new Map(storedSessions.map((session) => [session.id, session])).values()
        );
        if (!isCurrent || uniqueSessions.length === 0) return;
        setSessions(uniqueSessions);
        setActiveSessionId(uniqueSessions[0].id);
      } catch {
        // The chat API can be unavailable while the workspace UI remains usable.
      }
    }

    void loadHistory();
    return () => { isCurrent = false; };
  }, [workspaceSlug]);

  function startNewChat() {
    const session = { id: `local:${crypto.randomUUID()}`, title: isEnglish ? "New chat" : "Yeni sohbet", messages: [] };
    setSessions((items) => [session, ...items]);
    setActiveSessionId(session.id);
    setMessage("");
    setStatus("");
  }

  async function deleteChatSession(sessionId: string) {
    const isLocalSession = sessionId.startsWith("local:");

    try {
      if (!isLocalSession) {
        const result = await fetch(
          `${apiBaseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}?workspaceSlug=${encodeURIComponent(workspaceSlug)}`,
          { method: "DELETE" }
        );
        if (!result.ok) {
          const body = await result.json();
          throw new Error(body.error ?? "Chat session could not be deleted.");
        }
      }

      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId === sessionId) {
        if (remaining[0]) {
          setActiveSessionId(remaining[0].id);
        } else {
          startNewChat();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sohbet silinemedi.");
    }
  }

  function resizeHistory(event: PointerEvent<HTMLButtonElement>) {
    if (!resizeStart) return;
    const nextWidth = Math.min(360, Math.max(160, resizeStart.width + event.clientX - resizeStart.x));
    setHistoryWidth(nextWidth);
    window.localStorage.setItem(historyWidthStorageKey, String(nextWidth));
  }

  async function sendMessage(value = message) {
    const prompt = value.trim();
    if (!prompt || isSending) return;

    const sessionId = activeSessionId;
    setSessions((items) => items.map((session) => session.id === sessionId ? {
      ...session,
      title: session.messages.length === 0 ? prompt : session.title,
      messages: [...session.messages, { id: crypto.randomUUID(), role: "user", content: prompt }]
    } : session));
    setMessage("");
    setStatus("");
    setIsSending(true);

    try {
      const result = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          workspaceSlug,
          message: prompt,
          sessionId: sessionId.startsWith("local:") ? undefined : sessionId
        })
      });
      const body = await result.json();

      if (!result.ok) {
        setStatus(body.error ?? (isEnglish ? "Chat request failed." : "Chat isteği başarısız oldu."));
        return;
      }

      const response = body as ChatResponse;
      setSessions((items) => items.map((session) => session.id === sessionId ? {
        ...session,
        id: response.sessionId,
        messages: [...session.messages, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.answer,
          sources: response.sources,
          queryType: response.queryType
        }]
      } : session));
      setActiveSessionId((current) => current === sessionId ? response.sessionId : current);
    } catch {
      setStatus(isEnglish ? "The server could not be reached. Make sure the API service is running." : "Sunucuya ulaşılamadı. API servisinin çalıştığından emin olun.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section
      className="chat-layout"
      aria-label={isEnglish ? "Knowledge base chat" : "Bilgi tabanı sohbeti"}
      style={{ gridTemplateColumns: `${historyWidth}px minmax(0, 1fr)` }}
    >
      <aside className="chat-history" aria-label={isEnglish ? "Chat history" : "Sohbet geçmişi"}>
        <button type="button" className="chat-history__new" onClick={startNewChat}>
          <span className="pi pi-plus" aria-hidden="true" /> {isEnglish ? "New chat" : "Yeni sohbet"}
        </button>
        <div className="chat-history__heading">{isEnglish ? "Chat history" : "Sohbet geçmişi"}</div>
        <nav>
          {sessions.map((session, index) => (
            <div className="chat-history__item" key={`${session.id}-${index}`}>
              <button
                type="button"
                className={session.id === activeSessionId ? "is-active" : ""}
                onClick={() => setActiveSessionId(session.id)}
                title={session.title}
              >
                <span className="pi pi-message" aria-hidden="true" />
                <span>{session.title}</span>
              </button>
              <button
                type="button"
                className="chat-history__delete"
                onClick={() => setPendingDeletion(session)}
                aria-label={isEnglish ? "Delete chat" : "Sohbeti sil"}
                title={isEnglish ? "Delete chat" : "Sohbeti sil"}
              ><span className="pi pi-trash" aria-hidden="true" /></button>
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="chat-history__resize"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizeStart({ x: event.clientX, width: historyWidth });
          }}
          onPointerMove={resizeHistory}
          onPointerUp={() => setResizeStart(null)}
          onPointerCancel={() => setResizeStart(null)}
          aria-label={isEnglish ? "Resize chat history" : "Sohbet geçmişi genişliğini değiştir"}
          title={isEnglish ? "Drag to resize" : "Genişliği değiştirmek için sürükleyin"}
        />
      </aside>
      <div className="chat-page">
      <div className="chat-page__conversation">
        {conversation.length === 0 ? (
          <div className="chat-welcome">
            <div className="chat-welcome__mark" aria-hidden="true"><span className="pi pi-sparkles" /></div>
            <p className="eyebrow">KnowledgeOS Assistant</p>
            <h3>{isEnglish ? "What would you like to explore?" : "Bugün neyi inceleyelim?"}</h3>
            <p>{isEnglish ? "I can answer using cited sources from the documents in your workspace." : "Çalışma alanınızdaki belgelerden kaynak göstererek yanıtlayabilirim."}</p>
            <div className="chat-suggestions">
              {(isEnglish ? englishSuggestions : suggestions).map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void sendMessage(suggestion)}>
                  <span>{suggestion}</span><i className="pi pi-arrow-up-right" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-thread">
            {conversation.map((item) => (
              <article className={`chat-message chat-message--${item.role}`} key={item.id}>
                <div className="chat-avatar" aria-hidden="true">
                  <span className={item.role === "user" ? "pi pi-user" : "pi pi-sparkles"} />
                </div>
                <div className="chat-message__content">
                  <strong>{item.role === "user" ? (isEnglish ? "You" : "Siz") : "KnowledgeOS"}</strong>
                  <p>{item.content}</p>
                  {item.role === "assistant" && item.sources.length > 0 ? (
                    <details className="chat-sources">
                      <summary><span className="pi pi-book" aria-hidden="true" /> {item.sources.length} {isEnglish ? "sources used" : "kaynak kullanıldı"}</summary>
                      <div>
                        {item.sources.map((source, index) => (
                          <article key={`${source.documentName}-${index}`}>
                            <div><strong>{source.documentName}</strong><span>{source.title}</span></div>
                            <p>{source.evidenceSnippet}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </article>
            ))}
            {isSending ? <div className="chat-thinking"><span /><span /><span /> {isEnglish ? "Preparing answer" : "Yanıt hazırlanıyor"}</div> : null}
          </div>
        )}
      </div>

      <div className="chat-composer-wrap">
        <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          <ATextarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            autoResize
            placeholder={isEnglish ? "Ask something about your documents..." : "Belgeleriniz hakkında bir şey sorun..."}
            aria-label={isEnglish ? "Your message" : "Mesajınız"}
          />
          <button className="chat-send" type="submit" disabled={!message.trim() || isSending} aria-label={isEnglish ? "Send message" : "Mesaj gönder"}>
            <span className="pi pi-arrow-up" aria-hidden="true" />
          </button>
        </form>
        {status ? <p className="chat-error">{status}</p> : null}
        <p className="chat-composer__hint">{isEnglish ? "Press Enter to send · Shift + Enter for a new line" : "Enter ile gönderin · Yeni satır için Shift + Enter"}</p>
      </div>
      </div>
      <ADialog
        visible={pendingDeletion !== null}
        onHide={() => setPendingDeletion(null)}
        header={isEnglish ? "Delete chat?" : "Sohbet silinsin mi?"}
        style={{ width: "min(420px, calc(100vw - 32px))" }}
        footer={
          <div className="chat-delete-dialog__actions">
            <AButton tone="secondary" onClick={() => setPendingDeletion(null)}>
              {isEnglish ? "Cancel" : "Vazgeç"}
            </AButton>
            <AButton
              className="chat-delete-dialog__confirm"
              onClick={() => {
                if (pendingDeletion) {
                  void deleteChatSession(pendingDeletion.id);
                  setPendingDeletion(null);
                }
              }}
            >
              {isEnglish ? "Delete" : "Sil"}
            </AButton>
          </div>
        }
      >
        <p className="chat-delete-dialog__text">
          {isEnglish
            ? `“${pendingDeletion?.title ?? ""}” and all of its messages will be permanently deleted.`
            : `“${pendingDeletion?.title ?? ""}” ve içindeki tüm mesajlar kalıcı olarak silinecek.`}
        </p>
      </ADialog>
    </section>
  );
}
