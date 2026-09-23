import { getDb, newId, now } from "../db.js";
import { broadcast } from "../realtime/hub.js";

export type Severity = "info" | "warning" | "critical";

export function notify(severity: Severity, title: string, body: string): string {
  const db = getDb();
  const id = newId();
  const at = now();
  db.prepare(`INSERT INTO notifications (id, severity, title, body, created_at) VALUES (?,?,?,?,?)`).run(
    id,
    severity,
    title,
    body,
    at
  );
  broadcast({ type: "notification", id, severity, title, body, at });
  return id;
}
