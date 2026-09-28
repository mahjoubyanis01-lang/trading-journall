import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Companion, Conversation } from "@task/shared";
import { api } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { MoreIcon, PlusIcon } from "../../components/Icons";
import { formatRelative } from "../../lib/time";

/** Accueil : liste des conversations, comme une messagerie. Un contact = un compagnon. */
export function HomeScreen() {
  const nav = useNavigate();
  const [companions, setCompanions] = useState<Companion[] | null>(null);
  const [convs, setConvs] = useState<Record<string, Conversation>>({});

  useEffect(() => {
    let alive = true;
    Promise.all([api.companions.list(), api.conversations.list()])
      .then(([c, v]) => {
        if (!alive) return;
        setCompanions(c.companions);
        setConvs(Object.fromEntries(v.conversations.map((x) => [x.companionId, x])));
      })
      .catch(() => alive && setCompanions([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (companions && companions.length === 0) nav("/new", { replace: true });
  }, [companions, nav]);

  return (
    <div className="screen">
      <header className="topbar">
        <div className="title" style={{ fontSize: 22, fontWeight: 700 }}>Messages</div>
        <Link to="/new" className="icon-btn" aria-label="Nouveau compagnon"><PlusIcon /></Link>
        <Link to="/settings" className="icon-btn" aria-label="Réglages"><MoreIcon /></Link>
      </header>
      <div className="screen-body">
        {!companions ? (
          <div className="center" style={{ padding: 40 }}><div className="spinner" /></div>
        ) : (
          <div className="list">
            {companions.map((c) => {
              const conv = convs[c.id];
              return (
                <Link key={c.id} to={`/c/${c.id}`} className="row">
                  <Avatar name={c.name} avatar={c.avatar} />
                  <div className="main">
                    <div className="name">
                      <span>{c.name}</span>
                      {conv?.lastMessageAt && <time>{formatRelative(conv.lastMessageAt)}</time>}
                    </div>
                    <div className="preview" style={conv && conv.unreadCount > 0 ? { color: "var(--fg)", fontWeight: 600 } : undefined}>
                      {conv?.lastMessagePreview ?? "Dis bonjour 👋"}
                    </div>
                  </div>
                  {conv && conv.unreadCount > 0 && (
                    <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 700, padding: "2px 8px" }}>{conv.unreadCount}</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
