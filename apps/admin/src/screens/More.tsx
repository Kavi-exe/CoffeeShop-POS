import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export default function MoreScreen({ onLogout }: { onLogout(): void }) {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [view, setView] = useState<"notifications" | "audit">("notifications");

  useEffect(() => {
    api("/notifications").then((list) => {
      setNotifs(list);
      if (list.some((n: any) => !n.read)) void api("/notifications/read-all", { method: "POST" });
    }).catch(() => undefined);
    api("/audit").then(setAudit).catch(() => undefined);
  }, []);

  return (
    <div>
      <div className="seg">
        <button className={view === "notifications" ? "active" : ""} onClick={() => setView("notifications")}>
          🔔 Notifications
        </button>
        <button className={view === "audit" ? "active" : ""} onClick={() => setView("audit")}>
          🛡 Audit log
        </button>
      </div>

      <div className="card">
        {view === "notifications" && (
          <>
            {notifs.length === 0 && <div className="empty">No notifications</div>}
            {notifs.map((n) => (
              <div className="list-item" key={n.id}>
                <div className="l">
                  <div>
                    <div className="t">{n.title}</div>
                    <div className="s">{n.body} · {new Date(n.createdAt).toLocaleString("en-GB")}</div>
                  </div>
                </div>
                <span className={`badge ${n.severity === "critical" ? "bad" : n.severity === "warning" ? "warn" : ""}`}>{n.severity}</span>
              </div>
            ))}
          </>
        )}

        {view === "audit" && (
          <>
            {audit.length === 0 && <div className="empty">No audit entries synced yet</div>}
            {audit.map((a) => (
              <div className="list-item" key={a.id}>
                <div className="l">
                  <div>
                    <div className="t">{a.detail}</div>
                    <div className="s">{a.userName ?? "system"} · {a.action} · {new Date(a.at).toLocaleString("en-GB")}</div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h3>Account</h3>
        <div className="list-item">
          <span className="t">{JSON.parse(localStorage.getItem("bb.user") ?? "{}").name ?? "User"}</span>
          <button className="badge bad" style={{ border: "none", fontSize: 12 }} onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
