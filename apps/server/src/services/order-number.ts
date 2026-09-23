import { getDb } from "../db.js";

/**
 * Allocate the next human-facing order number atomically.
 * SQLite INSERT ... ON CONFLICT ... RETURNING is executed inside the caller's
 * transaction, so two POS devices can never receive the same number.
 */
export function nextOrderNumber(): number {
  const db = getDb();
  const row = db
    .prepare(
      `INSERT INTO counters (name, value) VALUES ('order_no', 1000)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
    )
    .get() as any;
  return row.value as number;
}
