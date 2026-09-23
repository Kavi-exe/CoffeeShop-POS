import { useState } from "react";
import { usePos } from "../lib/store.js";
import { api } from "../lib/api.js";
import { syncNow } from "../lib/sync-manager.js";

const DEVICE_ID = (import.meta as any).env?.VITE_DEVICE_ID ?? "pos-01";
const DEVICE_NAME = (import.meta as any).env?.VITE_DEVICE_NAME ?? "POS 01";

export default function LoginScreen() {
  const setSession = usePos((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    setError("");
    try {
      const res = await api<any>("/auth/login", {
        method: "POST",
        body: { username, password, deviceId: DEVICE_ID },
        retry: false,
      });
      await setSession({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        user: res.user,
        deviceId: DEVICE_ID,
        deviceName: DEVICE_NAME,
      });
      await syncNow();
    } catch (err: any) {
      setError(
        err?.status === 0
          ? "Local server unreachable. Check the café network and try again."
          : err?.message ?? "Login failed"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo">☕</div>
        <h1>BrewBean POS</h1>
        <div className="tag">{DEVICE_NAME} · offline-ready</div>
        {error && <div className="err">{error}</div>}
        <div className="field">
          <label>Username</label>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="cashier1"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="••••••••"
          />
        </div>
        <button className="primary-btn" onClick={login} disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Start shift"}
        </button>
      </div>
    </div>
  );
}
