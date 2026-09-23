import type { SyncEntity } from "@brewbean/shared";
import { getDb, newId, now } from "../db.js";

/** Enqueue a mutation for cloud sync. Called inside/after local writes. */
export function enqueueOutbox(
  entity: SyncEntity,
  op: "insert" | "update" | "delete",
  payload: unknown
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO sync_outbox (envelope_id, entity, op, payload_json, at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(newId(), entity, op, JSON.stringify(payload), now());
}

export function pendingOutboxCount(): number {
  return (
    getDb().prepare("SELECT COUNT(*) c FROM sync_outbox WHERE pushed_at IS NULL").get() as any
  ).c;
}
