import type { Cents, Shift, ShiftMetrics } from "@brewbean/shared";
import { getDb, newId, now } from "../db.js";
import { audit, type AuditActor } from "./audit.js";
import { notify } from "./notify.js";
import { broadcast } from "../realtime/hub.js";

export function openShift(user: { id: string; name: string }, deviceId: string, openingCash: Cents, actor: AuditActor): Shift {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM shifts WHERE user_id = ? AND status = 'open'`)
    .get(user.id) as any;
  if (existing) return mapShift(existing);

  const id = newId();
  db.prepare(
    `INSERT INTO shifts (id, user_id, user_name, device_id, opening_cash_cents, status, opened_at)
     VALUES (?,?,?,?,?, 'open', ?)`
  ).run(id, user.id, user.name, deviceId, openingCash, now());
  audit(actor, "shift.open", "shifts", id, `Shift opened with ${money(openingCash)} float`);
  broadcast({ type: "shift.opened", shiftId: id, userName: user.name });
  return getShift(id)!;
}

export function closeShift(
  shiftId: string,
  countedCash: Cents,
  notes: string | undefined,
  actor: AuditActor
): Shift {
  const db = getDb();
  const metrics = computeShiftMetrics(shiftId);
  const difference = countedCash - metrics.expectedCash;

  db.prepare(
    `UPDATE shifts SET status='closed', closed_at=?, counted_cash_cents=?, expected_cash_cents=?, difference_cents=?, notes=? WHERE id=?`
  ).run(now(), countedCash, metrics.expectedCash, difference, notes ?? null, shiftId);

  audit(actor, "shift.close", "shifts", shiftId, `Shift closed — expected ${money(metrics.expectedCash)}, counted ${money(countedCash)}, difference ${money(difference)}`);
  if (difference !== 0) {
    audit(actor, "shift.variance", "shifts", shiftId, `Cash variance ${money(difference)} on shift close`);
    notify(difference < -1000 ? "warning" : "info", "Shift variance", `Counted cash differs by ${money(difference)}`);
  }
  broadcast({ type: "shift.closed", shiftId, userName: actor.name ?? "" });
  return getShift(shiftId)!;
}

export function getShift(id: string): Shift | undefined {
  const row = getDb().prepare(`SELECT * FROM shifts WHERE id = ?`).get(id) as any;
  return row ? mapShift(row) : undefined;
}

export function getOpenShiftForUser(userId: string): Shift | undefined {
  const row = getDb().prepare(`SELECT * FROM shifts WHERE user_id = ? AND status = 'open'`).get(userId) as any;
  return row ? mapShift(row) : undefined;
}

export function listShifts(limit = 50): Shift[] {
  return (getDb().prepare(`SELECT * FROM shifts ORDER BY opened_at DESC LIMIT ?`).all(limit) as any[]).map(mapShift);
}

export function computeShiftMetrics(shiftId: string): ShiftMetrics {
  const db = getDb();
  const shift = getShift(shiftId);
  if (!shift) throw new Error("Shift not found");

  const params: any[] = [shift.userId, shift.openedAt];
  let closedFilter = "";
  if (shift.closedAt) {
    closedFilter = " AND o.created_at <= ?";
    params.push(shift.closedAt);
  }

  const byMethod = db
    .prepare(
      `SELECT p.method, SUM(p.amount_cents) total, COUNT(*) cnt
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE o.cashier_id = ? AND o.status IN ('completed','paid','partially_refunded')
         AND p.created_at >= ?${closedFilter}
       GROUP BY p.method`
    )
    .all(...params) as any[];

  const refundRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) c FROM refunds r
       WHERE r.method = 'cash' AND r.user_id = ? AND r.created_at >= ?`
    )
    .get(shift.userId, shift.openedAt) as any;

  let cashSales = 0, cardSales = 0, qrSales = 0, otherSales = 0, totalSales = 0;
  for (const r of byMethod) {
    totalSales += r.total;
    if (r.method === "cash") cashSales = r.total;
    else if (r.method === "card" || r.method === "bank_transfer") cardSales = r.total;
    else if (r.method === "qr" || r.method === "online") qrSales = r.total;
    else otherSales += r.total;
  }

  const orderCountRow = db
    .prepare(
      `SELECT COUNT(*) c FROM orders o
       WHERE o.cashier_id = ? AND o.status IN ('completed','paid','partially_refunded') AND o.created_at >= ?${closedFilter}`
    )
    .get(...params) as any;

  const discountRow = db
    .prepare(
      `SELECT COALESCE(SUM(order_discount_cents),0) s FROM orders o
       WHERE o.cashier_id = ? AND o.created_at >= ?${closedFilter}`
    )
    .get(...params) as any;

  const expectedCash = shift.openingCash + cashSales - refundRow.s;

  return {
    shiftId,
    cashSales,
    cardSales,
    qrSales,
    otherSales,
    totalSales,
    orderCount: orderCountRow.c,
    refundCount: refundRow.c,
    refundTotal: refundRow.s,
    cashRefunds: refundRow.s,
    discountTotal: discountRow.s,
    expectedCash,
  };
}

function mapShift(r: any): Shift {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    deviceId: r.device_id,
    openingCash: r.opening_cash_cents,
    closedAt: r.closed_at ?? undefined,
    countedCash: r.counted_cash_cents ?? undefined,
    expectedCash: r.expected_cash_cents ?? undefined,
    difference: r.difference_cents ?? undefined,
    notes: r.notes ?? undefined,
    status: r.status,
    openedAt: r.opened_at,
  };
}

function money(c: number): string {
  return (c / 100).toFixed(2);
}
