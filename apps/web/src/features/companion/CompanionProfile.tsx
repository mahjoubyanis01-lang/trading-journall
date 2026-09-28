import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Companion } from "@task/shared";
import { api } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { BackIcon } from "../../components/Icons";
import { Switch } from "../../components/Switch";

const TRAITS: { key: keyof Companion["personality"]["traits"]; label: string; low: string; high: string }[] = [
  { key: "humor", label: "Humour", low: "Sérieux·se", high: "Très drôle" },
  { key: "affection", label: "Affection", low: "Réservé·e", high: "Très tendre" },
  { key: "teasing", label: "Taquinerie", low: "Jamais", high: "Beaucoup" },
  { key: "curiosity", label: "Curiosité", low: "Laisse venir", high: "Veut tout savoir" },
  { key: "energy", label: "Énergie", low: "Posé·e", high: "Débordant·e" },
  { key: "spontaneity", label: "Spontanéité", low: "Mesuré·e", high: "Imprévisible" },
];

/** Profil du compagnon : identité, personnalité (ajustable), permissions, suppression. */
export function CompanionProfile() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [c, setC] = useState<Companion | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) api.companions.get(id).then((r) => setC(r.companion)).catch(() => nav("/", { replace: true }));
  }, [id, nav]);

  async function save(input: Record<string, unknown>) {
    if (!id) return;
    setSaving(true);
    try {
      const { companion } = await api.companions.update(id, input);
      setC(companion);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id || !c) return;
    if (!confirm(`Supprimer ${c.name} ? Toute votre histoire (messages, souvenirs) sera effacée.`)) return;
    await api.companions.delete(id);
    nav("/", { replace: true });
  }

  if (!c) return <div className="screen center" style={{ justifyContent: "center" }}><div className="spinner" /></div>;

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Retour"><BackIcon /></button>
        <div className="title">{c.name}</div>
        {saving && <div className="spinner" style={{ width: 16, height: 16 }} />}
      </header>
      <div className="screen-body">
        <div className="container">
          <div className="center" style={{ padding: "24px 0 8px" }}>
            <Avatar name={c.name} avatar={c.avatar} size="xl" />
            <h2 style={{ margin: "8px 0 0" }}>{c.name}</h2>
            {c.userNickname && <div className="muted">t'appelle « {c.userNickname} »</div>}
          </div>

          <Link to={`/c/${c.id}/brain`} className="card" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <span style={{ fontSize: 26 }}>🧠</span>
            <div style={{ flex: 1 }}>
              <b>Ce que {c.name} sait de toi</b>
              <div className="muted" style={{ fontSize: 13 }}>Souvenirs, événements, lecture d'humeur. Tout est modifiable.</div>
            </div>
            <span className="muted">›</span>
          </Link>

          <div className="section">Identité</div>
          <div className="card">
            <div className="field"><label>Nom</label><input className="input" defaultValue={c.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && save({ name: e.target.value.trim() })} /></div>
            <div className="field"><label>Comment {c.name} t'appelle</label><input className="input" defaultValue={c.userNickname ?? ""} maxLength={40} onBlur={(e) => e.target.value.trim() !== (c.userNickname ?? "") && save({ userNickname: e.target.value.trim() || undefined })} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Bio</label><textarea className="input" rows={2} defaultValue={c.bio ?? ""} maxLength={300} onBlur={(e) => e.target.value !== (c.bio ?? "") && save({ bio: e.target.value })} /></div>
          </div>

          <div className="section">Caractère</div>
          <div className="card">
            {TRAITS.map((t) => (
              <div className="slider" key={t.key}>
                <div className="labels"><span>{t.low}</span><span style={{ fontWeight: 600, color: "var(--fg)" }}>{t.label}</span><span>{t.high}</span></div>
                <input type="range" min={0} max={1} step={0.05} defaultValue={c.personality.traits[t.key]} onChange={(e) => save({ personality: { traits: { [t.key]: Number(e.target.value) } } })} />
              </div>
            ))}
            <div className="labels muted" style={{ fontSize: 13 }}>Sa personnalité reste cohérente : ces réglages sont un point de départ, elle évolue un peu avec votre relation.</div>
          </div>

          <div className="section">Présence</div>
          <div className="card">
            <div className="field"><label>Messages spontanés</label>
              <div className="chips">
                {([["never", "Jamais"], ["rare", "Rarement"], ["sometimes", "Parfois"], ["often", "Souvent"]] as const).map(([v, l]) => (
                  <button key={v} type="button" className={`chip ${c.personality.style.initiativeFrequency === v ? "selected" : ""}`} onClick={() => save({ personality: { style: { initiativeFrequency: v } } })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="toggle-row"><div className="t"><b>Peut m'écrire de {c.name.endsWith("a") ? "elle" : "lui"}-même</b></div><Switch label="Messages spontanés" on={c.permissions.spontaneousMessages} onChange={(v) => save({ permissions: { spontaneousMessages: v } })} /></div>
            <div className="toggle-row"><div className="t"><b>Notifications</b></div><Switch label="Notifications" on={c.permissions.notifications} onChange={(v) => save({ permissions: { notifications: v } })} /></div>
            <div className="toggle-row"><div className="t"><b>Stories</b></div><Switch label="Stories" on={c.permissions.stories} onChange={(v) => save({ permissions: { stories: v } })} /></div>
            <div className="toggle-row"><div className="t"><b>Appels spontanés</b><span>Disponible avec les appels</span></div><Switch label="Appels spontanés" on={c.permissions.spontaneousCalls} onChange={(v) => save({ permissions: { spontaneousCalls: v } })} /></div>
          </div>

          <div style={{ padding: "24px 0 40px" }}>
            <button className="btn danger block" onClick={remove}>Supprimer {c.name} et notre histoire</button>
          </div>
        </div>
      </div>
    </div>
  );
}
