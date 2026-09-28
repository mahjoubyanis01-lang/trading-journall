import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { api, ApiError } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { Switch } from "../../components/Switch";

/**
 * Onboarding conversationnel (section 3). Chaque étape est une question posée par TASK,
 * la réponse apparaît comme une bulle de l'utilisateur. Court : le reste s'apprend en discutant.
 */

type Step = "welcome" | "account" | "name" | "nickname" | "voice" | "look" | "vibe" | "presence" | "creating";
const COLORS = ["#7C5CFF", "#FF6B9D", "#FF8A5C", "#2EC4B6", "#3A86FF", "#F4C20D", "#8AC926", "#B5179E"];

interface Draft {
  name: string;
  nickname: string;
  gender: "feminine" | "masculine" | "neutral";
  voiceId: string;
  color: string;
  style: "soft" | "bold" | "minimal";
  preset: string | null;
  humor: number;
  affection: number;
  initiativeFrequency: "never" | "rare" | "sometimes" | "often";
  preferredChannel: "text" | "voice" | "call";
  spontaneousCalls: boolean;
  notifications: boolean;
  stories: boolean;
}

interface Catalog {
  presets: { id: string; label: string; description: string }[];
  voices: { id: string; gender: string; label: string; description: string }[];
}

export function OnboardingFlow() {
  const { user, loading, setUser } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [transcript, setTranscript] = useState<{ who: "them" | "me"; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    nickname: "",
    gender: "feminine",
    voiceId: "aria",
    color: COLORS[0]!,
    style: "soft",
    preset: null,
    humor: 0.6,
    affection: 0.5,
    initiativeFrequency: "sometimes",
    preferredChannel: "text",
    spontaneousCalls: false,
    notifications: true,
    stories: true,
  });
  const [account, setAccount] = useState({ email: "", password: "", displayName: "" });

  useEffect(() => {
    api.companions.catalog().then(setCatalog).catch(() => setCatalog({ presets: [], voices: [] }));
  }, []);

  useEffect(() => {
    if (user && !draft.nickname && user.displayName) setDraft((d) => ({ ...d, nickname: user.displayName ?? "" }));
  }, [user, draft.nickname]);

  const say = (text: string) => setTranscript((t) => [...t, { who: "them", text }]);
  const answer = (text: string) => setTranscript((t) => [...t, { who: "me", text }]);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  function go(next: Step) {
    setError(null);
    setStep(next);
    const q: Partial<Record<Step, string[]>> = {
      account: ["avant tout, il me faut un moyen de te retrouver la prochaine fois"],
      name: ["ok !", "comment tu aimerais m'appeler ?"],
      nickname: ["et toi, je t'appelle comment ?"],
      voice: ["quelle voix tu me verrais ?"],
      look: ["et pour mon look ?"],
      vibe: ["dernière question importante : je suis plutôt comment ?"],
      presence: ["et niveau présence, tu préfères quoi ? tu pourras changer quand tu veux"],
    };
    (q[next] ?? []).forEach((line, i) => setTimeout(() => say(line), 250 * (i + 1)));
  }

  const voices = useMemo(() => (catalog?.voices ?? []).filter((v) => v.gender === draft.gender), [catalog, draft.gender]);
  useEffect(() => {
    if (voices.length && !voices.some((v) => v.id === draft.voiceId)) patch({ voiceId: voices[0]!.id });
  }, [voices, draft.voiceId]);

  async function submitAccount() {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.auth.register({
        email: account.email,
        password: account.password,
        displayName: account.displayName || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language.slice(0, 2) || "fr",
      });
      setUser(user);
      answer(account.displayName ? `moi c'est ${account.displayName}` : "c'est bon");
      if (account.displayName) patch({ nickname: account.displayName });
      go("name");
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === "validation_error" ? "Vérifie l'email et le mot de passe (8 caractères minimum)." : e.message) : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setStep("creating");
    setBusy(true);
    try {
      const { companion } = await api.companions.create({
        name: draft.name,
        userNickname: draft.nickname || undefined,
        voice: { gender: draft.gender, voiceId: draft.voiceId },
        avatar: { color: draft.color, style: draft.style },
        personality: {
          preset: draft.preset,
          traits: { humor: draft.humor, affection: draft.affection },
          style: { initiativeFrequency: draft.initiativeFrequency },
        },
        permissions: { spontaneousCalls: draft.spontaneousCalls, notifications: draft.notifications, stories: draft.stories, preferredChannel: draft.preferredChannel },
      });
      nav(`/c/${companion.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur réseau");
      setStep("presence");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  const stepIndex = ["welcome", "account", "name", "nickname", "voice", "look", "vibe", "presence"].indexOf(step);
  const total = user ? 6 : 7;

  return (
    <div className="screen">
      <div className="screen-body">
        <div className="onb-body">
          {step !== "welcome" && <div className="onb-step">{Math.max(1, stepIndex - (user ? 1 : 0))} / {total}</div>}
          {step === "welcome" ? (
            <div className="center" style={{ paddingTop: 48 }}>
              <div className="avatar xl" style={{ background: "linear-gradient(135deg,#7C5CFF,#FF6B9D)" }}>T</div>
              <div className="bubbles" style={{ alignItems: "flex-start", width: "100%", marginTop: 16 }}>
                <div className="bubble them">salut 👋</div>
                <div className="bubble them">moi c'est Task</div>
                <div className="bubble them">enfin… pour l'instant. tu vas pouvoir choisir mon nom, ma voix, ma tête, mon caractère</div>
                <div className="bubble them">et après on apprend à se connaître, tranquillement</div>
              </div>
            </div>
          ) : (
            <div className="bubbles">
              {transcript.map((b, i) => (
                <div key={i} className={`bubble ${b.who}`}>{b.text}</div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            {step === "account" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitAccount();
                }}
              >
                <div className="field"><label htmlFor="ob-name">Ton prénom</label><input id="ob-name" className="input" autoComplete="given-name" value={account.displayName} onChange={(e) => setAccount({ ...account, displayName: e.target.value })} /></div>
                <div className="field"><label htmlFor="ob-email">Email</label><input id="ob-email" className="input" type="email" required autoComplete="email" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} /></div>
                <div className="field"><label htmlFor="ob-password">Mot de passe</label><input id="ob-password" className="input" type="password" required minLength={8} autoComplete="new-password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} /></div>
                {error && <p className="error">{error}</p>}
                <button className="btn block" disabled={busy}>Continuer</button>
                <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: 14 }}>
                  Déjà un compte ? <Link to="/login" style={{ color: "var(--accent)", fontWeight: 600 }}>Se connecter</Link>
                </p>
              </form>
            )}

            {step === "name" && (
              <form onSubmit={(e) => { e.preventDefault(); if (draft.name.trim()) { answer(draft.name.trim()); go("nickname"); } }}>
                <input className="input" autoFocus placeholder="Emma, Sam, Lina…" maxLength={40} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                <button className="btn block" style={{ marginTop: 12 }} disabled={!draft.name.trim()}>C'est ça</button>
              </form>
            )}

            {step === "nickname" && (
              <form onSubmit={(e) => { e.preventDefault(); answer(draft.nickname.trim() || "comme tu veux"); go("voice"); }}>
                <input className="input" autoFocus placeholder={user?.displayName ?? "ton prénom, un surnom…"} maxLength={40} value={draft.nickname} onChange={(e) => patch({ nickname: e.target.value })} />
                <button className="btn block" style={{ marginTop: 12 }}>Continuer</button>
              </form>
            )}

            {step === "voice" && (
              <div>
                <div className="chips" style={{ marginBottom: 14 }}>
                  {(["feminine", "masculine", "neutral"] as const).map((g) => (
                    <button key={g} type="button" className={`chip ${draft.gender === g ? "selected" : ""}`} onClick={() => patch({ gender: g })}>
                      {g === "feminine" ? "Féminine" : g === "masculine" ? "Masculine" : "Neutre"}
                    </button>
                  ))}
                </div>
                <div className="choices">
                  {voices.map((v) => (
                    <button key={v.id} type="button" className={`choice ${draft.voiceId === v.id ? "selected" : ""}`} onClick={() => patch({ voiceId: v.id })}>
                      <b>{v.label}</b><span>{v.description}</span>
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>L'écoute des voix arrive avec les messages vocaux.</p>
                <button className="btn block" style={{ marginTop: 12 }} onClick={() => { answer(voices.find((v) => v.id === draft.voiceId)?.label ?? draft.voiceId); go("look"); }}>Continuer</button>
              </div>
            )}

            {step === "look" && (
              <div>
                <div className="center" style={{ marginBottom: 18 }}>
                  <Avatar name={draft.name} avatar={{ kind: "stylized", color: draft.color, style: draft.style, referenceMediaId: null }} size="xl" />
                </div>
                <div className="swatches" style={{ justifyContent: "center", marginBottom: 16 }}>
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={c} className={`swatch ${draft.color === c ? "selected" : ""}`} style={{ background: c }} onClick={() => patch({ color: c })} />
                  ))}
                </div>
                <div className="chips" style={{ justifyContent: "center" }}>
                  {(["soft", "bold", "minimal"] as const).map((s) => (
                    <button key={s} type="button" className={`chip ${draft.style === s ? "selected" : ""}`} onClick={() => patch({ style: s })}>
                      {s === "soft" ? "Doux" : s === "bold" ? "Franc" : "Minimal"}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 13, marginTop: 10, textAlign: "center" }}>Un vrai visage arrivera plus tard. Pour l'instant, une couleur qui lui ressemble.</p>
                <button className="btn block" style={{ marginTop: 12 }} onClick={() => { answer("comme ça 👌"); go("vibe"); }}>Continuer</button>
              </div>
            )}

            {step === "vibe" && (
              <div>
                <div className="choices" style={{ marginBottom: 16 }}>
                  {(catalog?.presets ?? []).map((p) => (
                    <button key={p.id} type="button" className={`choice ${draft.preset === p.id ? "selected" : ""}`} onClick={() => patch({ preset: p.id })}>
                      <b>{p.label}</b><span>{p.description}</span>
                    </button>
                  ))}
                </div>
                <div className="slider">
                  <div className="labels"><span>Sérieux·se</span><span>Humour</span><span>Très drôle</span></div>
                  <input type="range" min={0} max={1} step={0.05} value={draft.humor} onChange={(e) => patch({ humor: Number(e.target.value) })} />
                </div>
                <div className="slider">
                  <div className="labels"><span>Réservé·e</span><span>Affection</span><span>Très tendre</span></div>
                  <input type="range" min={0} max={1} step={0.05} value={draft.affection} onChange={(e) => patch({ affection: Number(e.target.value) })} />
                </div>
                <button className="btn block" onClick={() => { answer(catalog?.presets.find((p) => p.id === draft.preset)?.label ?? "un mélange à toi"); go("presence"); }}>Continuer</button>
              </div>
            )}

            {step === "presence" && (
              <div>
                <div className="section" style={{ marginTop: 0 }}>Messages spontanés</div>
                <div className="chips" style={{ marginBottom: 8 }}>
                  {([["never", "Jamais"], ["rare", "Rarement"], ["sometimes", "Parfois"], ["often", "Souvent"]] as const).map(([v, l]) => (
                    <button key={v} type="button" className={`chip ${draft.initiativeFrequency === v ? "selected" : ""}`} onClick={() => patch({ initiativeFrequency: v })}>{l}</button>
                  ))}
                </div>
                <div className="section">Tu préfères</div>
                <div className="chips">
                  {([["text", "Écrire"], ["voice", "Les vocaux"], ["call", "S'appeler"]] as const).map(([v, l]) => (
                    <button key={v} type="button" className={`chip ${draft.preferredChannel === v ? "selected" : ""}`} onClick={() => patch({ preferredChannel: v })}>{l}</button>
                  ))}
                </div>
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="toggle-row"><div className="t"><b>Notifications</b><span>Quand {draft.name || "ton compagnon"} t'écrit</span></div><Switch label="Notifications" on={draft.notifications} onChange={(v) => patch({ notifications: v })} /></div>
                  <div className="toggle-row"><div className="t"><b>Stories</b><span>Publie des moments de sa vie</span></div><Switch label="Stories" on={draft.stories} onChange={(v) => patch({ stories: v })} /></div>
                  <div className="toggle-row"><div className="t"><b>Appels spontanés</b><span>Peut t'appeler de lui-même (plus tard)</span></div><Switch label="Appels spontanés" on={draft.spontaneousCalls} onChange={(v) => patch({ spontaneousCalls: v })} /></div>
                </div>
                {error && <p className="error">{error}</p>}
                <button className="btn block" style={{ marginTop: 16 }} disabled={busy} onClick={() => { answer("c'est parti"); void create(); }}>Rencontrer {draft.name || "mon compagnon"}</button>
              </div>
            )}

            {step === "creating" && (
              <div className="center" style={{ padding: 32 }}><div className="spinner" /><p className="muted">{draft.name} arrive…</p></div>
            )}
          </div>
        </div>
      </div>

      {step === "welcome" && (
        <div className="onb-footer">
          <button className="btn block" onClick={() => go(user ? "name" : "account")}>On commence</button>
          {!user && <Link to="/login" className="btn subtle block">J'ai déjà un compte</Link>}
        </div>
      )}
    </div>
  );
}
