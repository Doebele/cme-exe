import { useState } from "react";
import { Link } from "react-router-dom";

export interface AdminLoginProps {
  onLogin: (password: string) => Promise<boolean>;
}

export default function AdminLogin({ onLogin }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const ok = await onLogin(password);
    if (!ok) setError("Wrong password");
    setBusy(false);
  };

  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={handleSubmit}>
        <p className="font-display admin-login__kicker">CME.exe // Admin</p>
        <h1 className="font-display admin-login__title crt-glow">
          AUTHENTICATION
        </h1>

        <label className="font-display admin-login__label" htmlFor="admin-pw">
          Password
        </label>
        <input
          id="admin-pw"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="admin-input admin-login__input"
          placeholder="••••••••"
        />

        {error && <div className="admin-error">{error}</div>}

        <button
          type="submit"
          disabled={busy || !password}
          className="admin-btn admin-btn--accent admin-btn--block font-display"
        >
          {busy ? "Verifying…" : "Login"}
        </button>

        <Link
          to="/"
          className="admin-login__back font-display"
        >
          ← back to lab
        </Link>
      </form>
    </div>
  );
}
