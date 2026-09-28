import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Companion, Conversation, ConversationStreamEvent, Message } from "@task/shared";
import { api } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { BackIcon, SendIcon } from "../../components/Icons";
import { formatTime } from "../../lib/time";

/**
 * Écran de conversation. Les messages du compagnon arrivent via SSE :
 * "typing" → indicateur, "delta" → texte en cours, "message" → bulle finale.
 */
export function ChatScreen() {
  const { id: companionId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [partial, setPartial] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!companionId) return;
    let alive = true;
    Promise.all([api.companions.get(companionId), api.conversations.forCompanion(companionId)])
      .then(async ([c, v]) => {
        if (!alive) return;
        setCompanion(c.companion);
        setConv(v.conversation);
        const { messages } = await api.conversations.messages(v.conversation.id);
        if (alive) setMessages(messages);
        void api.conversations.markRead(v.conversation.id);
      })
      .catch(() => nav("/", { replace: true }));
    return () => {
      alive = false;
    };
  }, [companionId, nav]);

  // Flux SSE de la conversation.
  useEffect(() => {
    if (!conv) return;
    const es = new EventSource(`/api/conversations/${conv.id}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as ConversationStreamEvent;
      if (e.type === "typing") setTyping(true);
      else if (e.type === "delta") setPartial((p) => (p ?? "") + e.text);
      else if (e.type === "message") {
        setPartial(null);
        setTyping(false);
        setMessages((m) => (m.some((x) => x.id === e.message.id) ? m : [...m, e.message]));
        if (e.message.sender === "companion") void api.conversations.markRead(conv.id);
      } else if (e.type === "error") {
        setTyping(false);
        setPartial(null);
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [conv]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, partial, typing]);

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const content = draft.trim();
      if (!content || !conv || sending) return;
      setDraft("");
      setSending(true);
      try {
        const { message } = await api.conversations.send(conv.id, content);
        setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
      } catch {
        setDraft(content);
      } finally {
        setSending(false);
      }
    },
    [draft, conv, sending],
  );

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  if (!companion) return <div className="screen center" style={{ justifyContent: "center" }}><div className="spinner" /></div>;

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => nav("/")} aria-label="Retour"><BackIcon /></button>
        <Link to={`/c/${companion.id}/profile`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <Avatar name={companion.name} avatar={companion.avatar} />
          <div className="title">
            {companion.name}
            <div className="subtitle">{typing ? "écrit…" : "en ligne"}</div>
          </div>
        </Link>
      </header>

      <div className="screen-body" style={{ padding: "8px 12px" }}>
        {messages.length === 0 && !typing && !partial && (
          <div className="empty">
            <Avatar name={companion.name} avatar={companion.avatar} size="lg" />
            <p style={{ marginTop: 12 }}>C'est le début de votre histoire.</p>
          </div>
        )}
        <div className="bubbles">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showTime = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 10 * 60_000;
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {showTime && <div className="bubble-meta" style={{ alignSelf: "center" }}>{formatTime(m.createdAt)}</div>}
                <div className={`bubble ${m.sender === "user" ? "me" : "them"}`}>{m.content}</div>
              </div>
            );
          })}
          {partial && <div className="bubble them">{partial}</div>}
          {typing && !partial && (
            <div className="bubble them typing" aria-label={`${companion.name} écrit`}><i /><i /><i /></div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={send}>
        <textarea rows={1} placeholder="Message" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} aria-label="Message" />
        <button className="send" type="submit" disabled={!draft.trim() || sending} aria-label="Envoyer"><SendIcon /></button>
      </form>
    </div>
  );
}
