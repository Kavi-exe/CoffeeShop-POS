import { getDb, newId, now } from "../db.js";

export interface AuditActor {
  id?: string;
  name?: string;
  role?: string;
  deviceId?: string;
}

export function audit(
  actor: AuditActor,
  action: string,
  entity: string,
  entityId: string | undefined,
  detail: string,
  meta?: Record<string, unknown>
): void {
  const db = getDb();
  const id = newId();
  const at = now();
  db.prepare(
    `INSERT INTO audit_log (id, at, user_id, user_name, role, device_id, action, entity, entity_id, detail, meta_json, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'local')`
  ).run(
    id,
    at,
    actor.id ?? null,
    actor.name ?? null,
    actor.role ?? null,
    actor.deviceId ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    detail,
    meta ? JSON.stringify(meta) : null
  );
  enqueueOutbox("audit_logs", "insert", { id, at, userId: actor.id, userName: actor.name, role: actor.role, deviceId: actor.deviceId, action, entity, entityId, detail, meta, source: "local" });
}

import { enqueueOutbox } from "./outbox.js";
