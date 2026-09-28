import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../app/AuthContext";

export function LoginScreen() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.auth.login({ email, password });
      setUser(user);
      nav("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de se connecter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="onb-body">
        <div className="bubbles">
          <div className="bubble them">re 👋</div>
          <div className="bubble them">connecte-toi et on reprend où on en était</div>
        </div>
        <form onSubmit={submit} style={{ marginTop: 24 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn block" disabled={busy}>Se connecter</button>
        </form>
        <p className="muted" style={{ textAlign: "center", marginTop: 20 }}>
          Pas encore de compte ? <Link to="/welcome" style={{ color: "var(--accent)", fontWeight: 600 }}>Commencer</Link>
        </p>
      </div>
    </div>
  );
}
