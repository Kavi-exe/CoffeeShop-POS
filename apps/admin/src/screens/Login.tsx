import { useState } from "react";

export default function Login({ onLogin }: { onLogin(): void }) {
  const [email, setEmail] = useState("owner@brewbean.cafe");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Login failed");
      }
      const body = await res.json();
      localStorage.setItem("bb.access", body.accessToken);
      localStorage.setItem("bb.refresh", body.refreshToken);
      localStorage.setItem("bb.user", JSON.stringify(body.user));
      onLogin();
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">☕</div>
        <h1>BrewBean Admin</h1>
        <div className="tag">Owner &amp; manager remote monitoring</div>
        {error && <div className="err">{error}</div>}
        <div className="field">
          <label>Email</label>
          <input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <button className="primary-btn" onClick={submit} disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
