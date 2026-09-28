import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { api } from "../../lib/api";
import { BackIcon } from "../../components/Icons";
import { Switch } from "../../components/Switch";

export function SettingsScreen() {
  const { user, setUser, logout } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function update(input: Record<string, unknown>) {
    setBusy(true);
    try {
      const { user } = await api.users.update(input);
      setUser(user);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!confirm("Supprimer définitivement ton compte, tes compagnons et toutes les conversations ?")) return;
    await api.users.deleteAccount();
    setUser(null);
    nav("/welcome", { replace: true });
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Retour"><BackIcon /></button>
        <div className="title">Réglages</div>
      </header>
      <div className="screen-body">
        <div className="container">
          <div className="section">Toi</div>
          <div className="card">
            <div className="field"><label>Prénom</label><input className="input" defaultValue={user.displayName ?? ""} onBlur={(e) => e.target.value !== (user.displayName ?? "") && update({ displayName: e.target.value || undefined })} /></div>
            <div className="muted" style={{ fontSize: 14 }}>{user.email}</div>
          </div>
          <div className="section">Confidentialité</div>
          <div className="card">
            <div className="toggle-row"><div className="t"><b>Notifications</b><span>Messages, stories, rappels</span></div><Switch label="Notifications" on={user.preferences.notifications.enabled} onChange={(v) => update({ preferences: { notifications: { enabled: v } } })} /></div>
            <div className="toggle-row"><div className="t"><b>Apprendre mes habitudes</b><span>Heures de réveil, de travail… pour choisir quand écrire</span></div><Switch label="Habitudes" on={user.preferences.habitLearning} onChange={(v) => update({ preferences: { habitLearning: v } })} /></div>
            <div className="toggle-row"><div className="t"><b>Souvenirs sensibles</b><span>Retenir ce que je dis sur ma santé, mes croyances, mes finances</span></div><Switch label="Souvenirs sensibles" on={user.preferences.sensitiveMemory} onChange={(v) => update({ preferences: { sensitiveMemory: v } })} /></div>
          </div>
          <div className="section">Compte</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 40 }}>
            <button className="btn ghost block" disabled={busy} onClick={() => logout().then(() => nav("/welcome", { replace: true }))}>Se déconnecter</button>
            <button className="btn danger block" disabled={busy} onClick={deleteAccount}>Supprimer mon compte et mes données</button>
          </div>
        </div>
      </div>
    </div>
  );
}
