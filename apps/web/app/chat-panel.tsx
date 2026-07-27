"use client";

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ADialog, AButton, AIcon, ATextarea } from "../components/ui";
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
  | { id: string; role: "user"; content: string; createdAt: string }
  | { id: string; role: "assistant"; content: string; createdAt: string; sources: ChatSource[]; queryType: string };

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

function formatMessageTimestamp(value: string, isEnglish: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(isEnglish ? "en-GB" : "tr-TR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

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
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [answerLength, setAnswerLength] = useState<"normal" | "detailed">("normal");
  const [systemPromptVisible, setSystemPromptVisible] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSavingSystemPrompt, setIsSavingSystemPrompt] = useState(false);
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

  useEffect(() => {
    let isCurrent = true;
    const loadActiveModel = () => fetch(`${apiBaseUrl}/api/settings/models`)
      .then(async (response) => response.ok ? response.json() as Promise<{ llmProvider: string; llmModel: string }> : null)
      .then((settings) => { if (isCurrent && settings) setActiveModel(`${settings.llmProvider} / ${settings.llmModel}`); })
      .catch(() => undefined);
    void loadActiveModel();
    window.addEventListener("knowledgeos:model-settings-changed", loadActiveModel);
    return () => {
      isCurrent = false;
      window.removeEventListener("knowledgeos:model-settings-changed", loadActiveModel);
    };
  }, []);

  function startNewChat() {
    const session = { id: `local:${crypto.randomUUID()}`, title: isEnglish ? "New chat" : "Yeni sohbet", messages: [] };
    setSessions((items) => [session, ...items]);
    setActiveSessionId(session.id);
    setMessage("");
    setStatus("");
  }

  async function openSystemPrompt() {
    setSystemPromptVisible(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/chat-system-prompt/${encodeURIComponent(workspaceSlug)}`);
      const body = await response.json() as { prompt?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Chat system prompt could not be loaded.");
      setSystemPrompt(body.prompt ?? "");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Prompt yüklenemedi."); }
  }

  async function saveSystemPrompt() {
    setIsSavingSystemPrompt(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/chat-system-prompt/${encodeURIComponent(workspaceSlug)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: systemPrompt }) });
      const body = await response.json() as { prompt?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Chat system prompt could not be saved.");
      setSystemPrompt(body.prompt ?? systemPrompt);
      setSystemPromptVisible(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Prompt kaydedilemedi."); }
    finally { setIsSavingSystemPrompt(false); }
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
      if (error instanceof Error) {
        setStatus(error.message);
        return;
      }
      if (error instanceof Error) {
        setStatus(error.message);
        return;
      }
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
      messages: [...session.messages, { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: new Date().toISOString() }]
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
          sessionId: sessionId.startsWith("local:") ? undefined : sessionId,
          answerLength,
          stream: true
        })
      });
      if (!result.ok) {
        const body = await result.json();
        setStatus(body.error ?? (isEnglish ? "Chat request failed." : "Chat isteği başarısız oldu."));
        return;
      }

      const reader = result.body?.getReader();
      if (!reader) throw new Error("Streaming response was empty.");
      const assistantId = crypto.randomUUID();
      let pending = "";
      let streamed = "";
      let sourceResponse: ChatResponse | null = null;
      const addAssistant = (response: ChatResponse) => setSessions((items) => items.map((session) => session.id === sessionId ? { ...session, messages: [...session.messages, { id: assistantId, role: "assistant", content: "", createdAt: new Date().toISOString(), sources: response.sources, queryType: response.queryType }] } : session));
      const append = (text: string) => setSessions((items) => items.map((session) => session.id === sessionId ? { ...session, messages: session.messages.map((item) => item.id === assistantId && item.role === "assistant" ? { ...item, content: item.content + text } : item) } : session));
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const events = pending.split("\n\n");
        pending = events.pop() ?? "";
        for (const event of events) {
          const name = event.match(/^event: (.+)$/m)?.[1];
          const data = event.match(/^data: (.+)$/m)?.[1];
          if (!name || !data) continue;
          const payload = JSON.parse(data) as ChatResponse | string;
          if (name === "status") setStatus(payload as string);
          if (name === "meta") { sourceResponse = payload as ChatResponse; addAssistant(sourceResponse); }
          if (name === "token") { streamed += payload as string; append(payload as string); }
          if (name === "error") setStatus(payload as string);
          if (name === "done") {
            const response = payload as ChatResponse;
            if (!streamed && sourceResponse) append(response.answer);
            setSessions((items) => items.map((session) => session.id === sessionId ? { ...session, id: response.sessionId } : session));
            setActiveSessionId((current) => current === sessionId ? response.sessionId : current);
            setStatus("");
          }
        }
        if (done) break;
      }
      return;
      const response = null as unknown as ChatResponse;
      setSessions((items) => items.map((session) => session.id === sessionId ? {
        ...session,
        id: response.sessionId,
        messages: [...session.messages, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.answer,
          createdAt: new Date().toISOString(),
          sources: response.sources,
          queryType: response.queryType
        }]
      } : session));
      setActiveSessionId((current) => current === sessionId ? response.sessionId : current);
    } catch (error) {
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
        <div className="chat-history__actions">
          <button type="button" className="chat-history__new" onClick={startNewChat}>
            <span className="pi pi-plus" aria-hidden="true" /> {isEnglish ? "New chat" : "Yeni sohbet"}
          </button>
          <button type="button" className="chat-history__prompt" onClick={() => void openSystemPrompt()} aria-label={isEnglish ? "Chat prompt" : "Chat promptu"}>
            <AIcon icon={<span className="pi pi-cog" />} tooltip={isEnglish ? "Chat prompt" : "Chat promptu"} />
          </button>
        </div>
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
                  <div className="chat-message__meta">
                    <strong>{item.role === "user" ? (isEnglish ? "You" : "Siz") : "KnowledgeOS"}</strong>
                    <time dateTime={item.createdAt}>{formatMessageTimestamp(item.createdAt, isEnglish)}</time>
                  </div>
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
        <div className="chat-answer-length" aria-label={isEnglish ? "Answer length" : "Yanıt uzunluğu"}>
          <button type="button" className={answerLength === "normal" ? "is-active" : ""} onClick={() => setAnswerLength("normal")}>{isEnglish ? "Normal" : "Normal"}</button>
          <button type="button" className={answerLength === "detailed" ? "is-active" : ""} onClick={() => setAnswerLength("detailed")}>{isEnglish ? "Detailed" : "Ayrıntılı"}</button>
        </div>
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
        {activeModel ? <p className="chat-active-model"><i className="pi pi-sparkles" aria-hidden="true" /> {isEnglish ? "Active model:" : "Aktif model:"} {activeModel}</p> : null}
        <p className="chat-composer__hint">{isEnglish ? "Press Enter to send · Shift + Enter for a new line" : "Enter ile gönderin · Yeni satır için Shift + Enter"}</p>
      </div>
      </div>
      <ADialog visible={systemPromptVisible} onHide={() => !isSavingSystemPrompt && setSystemPromptVisible(false)} header={isEnglish ? "Chat system prompt" : "Chat sistem promptu"} style={{ width: "min(760px, calc(100vw - 32px))" }} footer={<div className="button-row"><AButton tone="secondary" onClick={() => setSystemPromptVisible(false)} disabled={isSavingSystemPrompt}>{isEnglish ? "Cancel" : "Vazgeç"}</AButton><AButton onClick={() => void saveSystemPrompt()} disabled={isSavingSystemPrompt || !systemPrompt.trim()}>{isSavingSystemPrompt ? (isEnglish ? "Saving..." : "Kaydediliyor...") : (isEnglish ? "Save" : "Kaydet")}</AButton></div>}><p>{isEnglish ? "Applied to every new chat answer in this workspace." : "Bu çalışma alanındaki her yeni chat yanıtında uygulanır."}</p><ATextarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={16} disabled={isSavingSystemPrompt} /></ADialog>
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
