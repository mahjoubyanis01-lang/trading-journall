import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type BrainResponse } from "../../lib/api";
import { BackIcon } from "../../components/Icons";

const TYPE_LABEL: Record<string, string> = {
  identity: "Identité",
  preference: "Goûts et habitudes",
  relationship: "Nous",
  shared: "Nos moments",
  semantic: "Ce qu'il sait",
  episodic: "Ce qu'on s'est raconté",
  event: "Événements",
};
const MOOD_LABEL: Record<string, string> = { neutral: "neutre", positive: "de bonne humeur", tired: "fatigué·e", stressed: "stressé·e", sad: "pas bien", angry: "agacé·e" };

/**
 * Le cerveau (cerveau.md) : tout ce que le compagnon retient, en tableaux lisibles.
 * Contrôle total : modifier, épingler, oublier. Transparence sur la lecture d'humeur et la calibration.
 */
export function BrainScreen() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [brain, setBrain] = useState<BrainResponse | null>(null);
  const [forget, setForget] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setBrain(await api.brain.get(id));
    } catch {
      nav("/", { replace: true });
    }
  }, [id, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!brain) return <div className="screen center" style={{ justifyContent: "center" }}><div className="spinner" /></div>;

  const groups = Object.entries(TYPE_LABEL)
    .map(([type, label]) => ({ type, label, items: brain.memories.filter((m) => m.type === type) }))
    .filter((g) => g.items.length > 0);
  const cur = brain.calibration.current;
  const dominant = Object.entries(cur)
    .filter(([k]) => k !== "neutral")
    .sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Retour"><BackIcon /></button>
        <div className="title">Cerveau {busy && <span className="spinner" style={{ width: 14, height: 14, display: "inline-block", marginLeft: 8 }} />}</div>
      </header>
      <div className="screen-body">
        <div className="container">
          <p className="muted" style={{ fontSize: 14, margin: "14px 0 4px" }}>
            Tout ce qui est retenu de vos conversations. Rien n'est déduit sur ta santé, tes croyances ou ton argent sans ton accord. Tu peux tout modifier ou effacer.
          </p>

          {brain.events.length > 0 && (
            <>
              <div className="section">À venir</div>
              <div className="card" style={{ padding: 0 }}>
                {brain.events.map((e) => (
                  <div key={e.id} className="toggle-row" style={{ padding: "12px 16px" }}>
                    <div className="t">
                      <b>{e.title}</b>
                      <span>{new Date(e.startsAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
                    </div>
                    <button className="btn subtle sm" onClick={() => run(() => api.brain.deleteEvent(e.id))} aria-label="Oublier">Oublier</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {groups.length === 0 && brain.events.length === 0 && <div className="empty">Rien pour l'instant. Ça se remplira au fil des conversations.</div>}

          {groups.map((g) => (
            <div key={g.type}>
              <div className="section">{g.label}</div>
              <div className="card" style={{ padding: 0 }}>
                {g.items.map((m) => (
                  <MemoryRow key={m.id} m={m} onSave={(patch) => run(() => api.brain.updateMemory(m.id, patch))} onForget={() => run(() => api.brain.deleteMemory(m.id))} />
                ))}
              </div>
            </div>
          ))}

          <div className="section">Oublier quelque chose</div>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              if (forget.trim()) run(() => api.brain.forget(id!, forget.trim())).then(() => setForget(""));
            }}
          >
            <input className="input" placeholder="ex. mon ancien travail" value={forget} onChange={(e) => setForget(e.target.value)} />
            <button className="btn ghost block" style={{ marginTop: 10 }} disabled={!forget.trim() || busy}>Oublier ce qui s'en rapproche</button>
          </form>

          <div className="section">Lecture d'humeur (auto-calibration)</div>
          <div className="card">
            {brain.calibration.readings === 0 ? (
              <span className="muted">Aucune lecture pour l'instant.</span>
            ) : (
              <>
                <div style={{ fontSize: 15 }}>
                  En ce moment, il te lit plutôt <b>{MOOD_LABEL[dominant?.[0] ?? "neutral"]}</b>
                  <span className="muted"> ({Math.round((dominant?.[1] ?? 0) * 100)} % de probabilité, sur {brain.calibration.readings} lecture{brain.calibration.readings > 1 ? "s" : ""})</span>.
                </div>
                {brain.calibration.unusual && <div style={{ marginTop: 6, fontSize: 14, color: "var(--accent)" }}>Différent de ton état habituel : il en tiendra compte avec délicatesse.</div>}
                {brain.calibration.lines.length > 0 && (
                  <ul className="muted" style={{ fontSize: 13, margin: "10px 0 0", paddingLeft: 18 }}>
                    {brain.calibration.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
                <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Ce n'est jamais un diagnostic : juste une impression pour adapter son ton, pas sa personnalité.</div>
              </>
            )}
          </div>
          <div style={{ height: 40 }} />
        </div>
      </div>
    </div>
  );
}

function MemoryRow({ m, onSave, onForget }: { m: BrainResponse["memories"][number]; onSave: (patch: { content?: string; pinned?: boolean }) => void; onForget: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(m.content);
  return (
    <div className="toggle-row" style={{ padding: "12px 16px", alignItems: "flex-start" }}>
      <div className="t" style={{ minWidth: 0 }}>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              if (value.trim() && value.trim() !== m.content) onSave({ content: value.trim() });
            }}
          >
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={300} onBlur={() => setEditing(false)} />
          </form>
        ) : (
          <b style={{ fontWeight: 500, cursor: "text" }} onClick={() => setEditing(true)}>
            {m.pinned && "📌 "}
            {m.content}
          </b>
        )}
        <span>
          {"★".repeat(Math.max(1, Math.round(m.importance * 3)))}
          {m.sensitive ? " · sensible" : ""}
          {m.source === "user_edited" ? " · modifié par toi" : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button className="btn subtle sm" onClick={() => onSave({ pinned: !m.pinned })} aria-label={m.pinned ? "Désépingler" : "Épingler"}>{m.pinned ? "Désépingler" : "Épingler"}</button>
        <button className="btn subtle sm" style={{ color: "var(--danger)" }} onClick={onForget} aria-label="Oublier">Oublier</button>
      </div>
    </div>
  );
}
