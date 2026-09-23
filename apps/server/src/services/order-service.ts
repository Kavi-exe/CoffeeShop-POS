import crypto from "node:crypto";
import type {
  Order,
  OrderItem,
  OrderTotals,
  Payment,
  PaymentMethod,
  Refund,
} from "@brewbean/shared";
import { getDb, newId, now } from "../db.js";
import { nextOrderNumber } from "./order-number.js";
import { notify } from "./notify.js";
import { deductForOrder } from "./recipe-engine.js";
import { enqueueOutbox } from "./outbox.js";
import { audit } from "./audit.js";
import { can } from "./auth.js";
import { computeTotals } from "@brewbean/shared";

export interface CartLineInput {
  productId: string;
  qty: number;
  modifierOptionIds: string[];
  discountCents?: number;
  note?: string;
}

export interface CreateOrderInput {
  deviceId: string;
  deviceOrderId?: string;
  type: "dine_in" | "takeaway" | "delivery";
  tableId?: string | null;
  delivery?: { customerName: string; phone: string; address: string; note?: string; feeCents: number } | null;
  customerNote?: string;
  cashier: { id: string; name: string };
  lines: CartLineInput[];
  orderDiscountCents?: number;
  offlineCreated?: boolean;
}

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  cashReceivedCents?: number;
  reference?: string;
  idempotencyKey?: string;
  splitParts?: Array<{ method: PaymentMethod; amountCents: number; reference?: string }>;
}

export interface CartLineResolved {
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  unitPriceCents: number;
  taxable: boolean;
  station: "bar" | "kitchen";
  modifiers: Array<{ optionId: string; groupId: string; groupName: string; name: string; priceDeltaCents: number }>;
  modifiersTotalCents: number;
  unitPriceWithModsCents: number;
  discountCents: number;
  lineTotalCents: number;
  note?: string;
}

/** Resolve cart lines against the catalog snapshotting prices. */
export function resolveLines(input: CartLineInput[]): CartLineResolved[] {
  const db = getDb();
  const out: CartLineResolved[] = [];
  for (const line of input) {
    const p = db
      .prepare(`SELECT id, name, sku, price_cents, taxable, category_id FROM products WHERE id = ? AND active = 1`)
      .get(line.productId) as any;
    if (!p) throw Object.assign(new Error(`Unknown product ${line.productId}`), { statusCode: 400 });

    const cat = db.prepare(`SELECT name FROM categories WHERE id = ?`).get(p.category_id) as any;
    const station = KITCHEN_CATEGORIES.has(cat?.name ?? "") ? "kitchen" : "bar";

    const mods: CartLineResolved["modifiers"] = [];
    let modsTotal = 0;
    if (line.modifierOptionIds.length > 0) {
      const placeholders = line.modifierOptionIds.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT mo.id, mo.name, mo.price_delta_cents, mg.id gid, mg.name gname
           FROM modifier_options mo JOIN modifier_groups mg ON mg.id = mo.group_id
           WHERE mo.id IN (${placeholders}) AND mo.available = 1`
        )
        .all(...line.modifierOptionIds) as any[];
      for (const m of rows) {
        mods.push({ optionId: m.id, groupId: m.gid, groupName: m.gname, name: m.name, priceDeltaCents: m.price_delta_cents });
        modsTotal += m.price_delta_cents;
      }
    }

    const unitWithMods = p.price_cents + modsTotal;
    const discount = Math.max(0, Math.min(line.discountCents ?? 0, unitWithMods * line.qty));
    out.push({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      qty: line.qty,
      unitPriceCents: p.price_cents,
      taxable: !!p.taxable,
      station,
      modifiers: mods,
      modifiersTotalCents: modsTotal,
      unitPriceWithModsCents: unitWithMods,
      discountCents: discount,
      lineTotalCents: unitWithMods * line.qty - discount,
      note: line.note,
    });
  }
  return out;
}

const KITCHEN_CATEGORIES = new Set(["Desserts", "Snacks", "Bakery", "Food"]);

export interface OrderRow {
  id: string;
  order_no: number;
  device_order_id: string | null;
  device_id: string;
  type: string;
  status: string;
  table_id: string | null;
  table_name: string | null;
  delivery_json: string | null;
  customer_note: string | null;
  cashier_id: string;
  cashier_name: string;
  subtotal_cents: number;
  order_discount_cents: number;
  taxable_base_cents: number;
  tax_cents: number;
  service_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  cost_cents: number | null;
  offline_created: number;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  synced_at: string | null;
}

export function rowToOrder(row: OrderRow, items?: OrderItem[], payments?: Payment[]): Order {
  return {
    id: row.id,
    orderNo: row.order_no,
    deviceOrderId: row.device_order_id ?? undefined,
    deviceId: row.device_id,
    type: row.type as Order["type"],
    status: row.status as Order["status"],
    tableId: row.table_id,
    tableName: row.table_name,
    delivery: row.delivery_json ? JSON.parse(row.delivery_json) : null,
    customerNote: row.customer_note ?? undefined,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    items: items ?? [],
    totals: {
      subtotal: row.subtotal_cents,
      orderDiscount: row.order_discount_cents,
      taxableBase: row.taxable_base_cents,
      tax: row.tax_cents,
      serviceCharge: row.service_cents,
      deliveryFee: row.delivery_fee_cents,
      total: row.total_cents,
    },
    payments: payments ?? [],
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    cancelReason: row.cancel_reason ?? undefined,
    offlineCreated: !!row.offline_created,
    syncedAt: row.synced_at ?? undefined,
  };
}

export function loadOrderItems(orderId: string): OrderItem[] {
  const rows = getDb()
    .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid`)
    .all(orderId) as any[];
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    qty: r.qty,
    unitPrice: r.unit_price_cents,
    modifiers: JSON.parse(r.modifiers_json),
    modifiersTotal: r.modifiers_total_cents,
    unitPriceWithModifiers: r.unit_price_with_mods_cents,
    discount: r.discount_cents,
    lineTotal: r.line_total_cents,
    note: r.note ?? undefined,
    station: r.station,
    status: r.status,
  }));
}

export function loadOrderPayments(orderId: string): Payment[] {
  const rows = getDb()
    .prepare(`SELECT * FROM payments WHERE order_id = ? ORDER BY created_at`)
    .all(orderId) as any[];
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    method: r.method,
    status: r.status,
    amount: r.amount_cents,
    cashReceived: r.cash_received_cents ?? undefined,
    changeGiven: r.change_cents ?? undefined,
    reference: r.reference ?? undefined,
    createdAt: r.created_at,
    splitParts: r.split_json ? JSON.parse(r.split_json) : undefined,
  }));
}

export function loadOrder(id: string): Order | null {
  const row = getDb().prepare(`SELECT * FROM orders WHERE id = ? OR device_order_id = ?`).get(id, id) as OrderRow | undefined;
  if (!row) return null;
  return rowToOrder(row, loadOrderItems(row.id), loadOrderPayments(row.id));
}

export function createOrder(input: CreateOrderInput, actor: { id?: string; name?: string; role?: string }): Order {
  const db = getDb();

  if (input.deviceOrderId) {
    const existing = db
      .prepare(`SELECT id FROM orders WHERE device_order_id = ?`)
      .get(input.deviceOrderId) as any;
    if (existing) return loadOrder(existing.id)!; // idempotent retry
  }

  const resolved = resolveLines(input.lines);
  if (resolved.length === 0) throw Object.assign(new Error("Empty order"), { statusCode: 400 });

  const settings = getSettingJson<any>("cafe", { taxPercent: 0, serviceChargePercent: 0 });
  const totals = computeTotals(
    resolved.map((r) => ({ lineTotal: r.lineTotalCents, productId: r.productId })),
    {
      orderDiscount: input.orderDiscountCents ?? 0,
      taxPercent: settings.taxPercent ?? 0,
      serviceChargePercent: settings.serviceChargePercent ?? 0,
      deliveryFee: input.delivery?.feeCents ?? 0,
      productsById: new Map(resolved.map((r) => [r.productId, { taxable: r.taxable }])),
    }
  );

  const orderId = newId();
  const createdAt = now();

  const tx = db.transaction(() => {
    const orderNo = nextOrderNumber();

    let tableName: string | null = null;
    if (input.tableId) {
      const t = db.prepare(`SELECT name FROM tables WHERE id = ?`).get(input.tableId) as any;
      tableName = t?.name ?? null;
    }

    db.prepare(
      `INSERT INTO orders (id, order_no, device_order_id, device_id, type, status, table_id, table_name,
        delivery_json, customer_note, cashier_id, cashier_name, subtotal_cents, order_discount_cents,
        taxable_base_cents, tax_cents, service_cents, delivery_fee_cents, total_cents, offline_created, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      orderId,
      orderNo,
      input.deviceOrderId ?? null,
      input.deviceId,
      input.type,
      "open",
      input.tableId ?? null,
      tableName,
      input.delivery ? JSON.stringify({ ...input.delivery, fee: input.delivery.feeCents }) : null,
      input.customerNote ?? null,
      input.cashier.id,
      input.cashier.name,
      totals.subtotal,
      totals.orderDiscount,
      totals.taxableBase,
      totals.tax,
      totals.serviceCharge,
      totals.deliveryFee,
      totals.total,
      input.offlineCreated ? 1 : 0,
      createdAt
    );

    const insItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, sku, qty, unit_price_cents,
        modifiers_json, modifiers_total_cents, unit_price_with_mods_cents, discount_cents, line_total_cents,
        note, station, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'queued')`
    );
    for (const r of resolved) {
      insItem.run(
        newId(),
        orderId,
        r.productId,
        r.productName,
        r.sku,
        r.qty,
        r.unitPriceCents,
        JSON.stringify(r.modifiers),
        r.modifiersTotalCents,
        r.unitPriceWithModsCents,
        r.discountCents,
        r.lineTotalCents,
        r.note ?? null,
        r.station
      );
    }

    // recipe-based inventory deduction — same transaction as the order
    const deductions = deductForOrder(
      resolved.map((r) => ({ productId: r.productId, qty: r.qty })),
      { orderId, userId: input.cashier.id, userName: input.cashier.name }
    );

    // cost of goods for profit reports
    let costCents = 0;
    const costStmt = db.prepare(`SELECT purchase_price_cents FROM ingredients WHERE id = ?`);
    const recipeStmt = db.prepare(`SELECT ingredient_id, qty_per_unit FROM recipes WHERE product_id = ?`);
    for (const r of resolved) {
      const recipe = recipeStmt.all(r.productId) as any[];
      for (const line of recipe) {
        const ing = costStmt.get(line.ingredient_id) as any;
        if (ing) costCents += ing.purchase_price_cents * line.qty_per_unit * r.qty;
      }
    }
    db.prepare(`UPDATE orders SET cost_cents = ? WHERE id = ?`).run(Math.round(costCents), orderId);

    return { orderNo, deductions };
  });

  const { orderNo, deductions } = tx();

  // notifications for shortfalls (after commit)
  for (const d of deductions) {
    if (d.shortfall > 0) {
      notify("critical", "Ingredient shortfall", `${d.name} went to ${d.balanceAfter}${d.unit} (short ${d.shortfall}${d.unit})`);
    } else if (d.balanceAfter <= 0) {
      notify("warning", "Out of stock", `${d.name} depleted`);
    }
    enqueueOutbox("inventory_transactions", "insert", { ingredientId: d.ingredientId, deltaQty: d.delta, balanceAfter: d.balanceAfter, orderId, at: createdAt });
  }

  enqueueOutbox("orders", "insert", loadOrder(orderId));
  audit(actor, "order.create", "orders", orderId, `Order #${orderNo} created (${input.type}) by ${input.cashier.name}`);

  return loadOrder(orderId)!;
}

export function payOrder(
  orderId: string,
  payment: PaymentInput,
  actor: { id: string; name: string; role: string; deviceId?: string }
): { order: Order; created: boolean } {
  const db = getDb();

  if (payment.idempotencyKey) {
    const existing = db.prepare(`SELECT order_id FROM payments WHERE idempotency_key = ?`).get(payment.idempotencyKey) as any;
    if (existing) return { order: loadOrder(existing.order_id)!, created: false };
  }

  const order = loadOrder(orderId);
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (order.status !== "open" && order.status !== "held") {
    throw Object.assign(new Error(`Order is ${order.status}, cannot accept payment`), { statusCode: 409 });
  }

  const due = order.totals.total -
    order.payments.filter((p) => p.status === "captured").reduce((s, p) => s + p.amount, 0);

  if (payment.method === "cash") {
    const received = payment.cashReceivedCents ?? payment.amountCents;
    if (received < order.totals.total && due === order.totals.total) {
      // part-payment of cash without split is rejected
      throw Object.assign(new Error("Insufficient cash received"), { statusCode: 400 });
    }
  }

  if (payment.amountCents <= 0) throw Object.assign(new Error("Invalid payment amount"), { statusCode: 400 });

  // Guard against underpayments: a non-split payment must cover the remaining
  // balance. POS clients always send the full amount; split payments are
  // validated against splitParts sum instead.
  const isSplit = payment.method === "split";
  if (isSplit) {
    const partsSum = (payment.splitParts ?? []).reduce((s, p) => s + p.amountCents, 0);
    if (!payment.splitParts?.length || Math.abs(partsSum - order.totals.total) > 1) {
      throw Object.assign(new Error("Split parts must sum to the order total"), { statusCode: 400 });
    }
  } else if (payment.amountCents < due - 1 && due > 0) {
    // allow ≤1 cent rounding slack
    throw Object.assign(
      new Error(`Underpayment: Rs ${(payment.amountCents / 100).toFixed(2)} of Rs ${(due / 100).toFixed(2)} due`),
      { statusCode: 400 }
    );
  }

  const paymentId = newId();
  const at = now();
  let change = 0;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO payments (id, order_id, method, status, amount_cents, cash_received_cents, change_cents, reference, split_json, idempotency_key, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      paymentId,
      order.id,
      payment.method,
      "captured",
      payment.amountCents,
      payment.cashReceivedCents ?? null,
      payment.method === "cash" ? Math.max(0, (payment.cashReceivedCents ?? 0) - payment.amountCents) : null,
      payment.reference ?? null,
      payment.splitParts ? JSON.stringify(payment.splitParts) : null,
      payment.idempotencyKey ?? null,
      at,
      actor.id
    );

    const paidSum = (
      db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE order_id = ? AND status='captured'`).get(order.id) as any
    ).s;
    const fullyPaid = paidSum >= order.totals.total;

    db.prepare(`UPDATE orders SET status = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ?`).run(
      fullyPaid ? "completed" : "paid",
      at,
      order.id
    );
    if (fullyPaid) {
      db.prepare(`UPDATE orders SET completed_at = ? WHERE id = ?`).run(at, order.id);
    }
    return fullyPaid;
  });

  const fullyPaid = tx();

  enqueueOutbox("payments", "insert", { id: paymentId, orderId: order.id, method: payment.method, amount: payment.amountCents, change, at, createdBy: actor.id });
  enqueueOutbox("orders", "update", loadOrder(order.id));

  audit(
    actor,
    "order.pay",
    "orders",
    order.id,
    `Order #${order.orderNo} paid ${payment.method} ${(payment.amountCents / 100).toFixed(2)}`
  );

  return { order: loadOrder(order.id)!, created: true };
}

export function refundOrder(
  orderId: string,
  amountCents: number,
  reason: string,
  restock: boolean,
  actor: { id: string; name: string; role: string }
): Order {
  const db = getDb();
  const order = loadOrder(orderId);
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (!["completed", "paid", "partially_refunded"].includes(order.status)) {
    throw Object.assign(new Error(`Cannot refund order in status ${order.status}`), { statusCode: 409 });
  }
  if (!can(actor.role, "orders.refund")) {
    throw Object.assign(new Error("Refund permission required"), { statusCode: 403 });
  }

  const paidTotal = order.payments.filter((p) => p.status === "captured").reduce((s, p) => s + p.amount, 0);
  const alreadyRefunded = (
    db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM refunds WHERE order_id = ?`).get(orderId) as any
  ).s;
  if (amountCents <= 0 || amountCents > paidTotal - alreadyRefunded) {
    throw Object.assign(new Error("Refund exceeds refundable amount"), { statusCode: 400 });
  }

  const id = newId();
  const at = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO refunds (id, order_id, payment_id, amount_cents, reason, method, user_id, user_name, restock, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, order.id, order.payments[0]?.id ?? null, amountCents, reason, order.payments[0]?.method ?? "cash", actor.id, actor.name, restock ? 1 : 0, at);

    const refundedTotal = (
      db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM refunds WHERE order_id = ?`).get(order.id) as any
    ).s;
    const newStatus = refundedTotal >= paidTotal ? "refunded" : "partially_refunded";
    db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(newStatus, order.id);
    db.prepare(`UPDATE payments SET status = ? WHERE order_id = ? AND status = 'captured'`).run(newStatus, order.id);
  });
  tx();

  if (restock) {
    restockOrderItems(order.id, actor);
  }

  enqueueOutbox("refunds", "insert", { id, orderId: order.id, amountCents, reason, userId: actor.id, at });
  enqueueOutbox("orders", "update", loadOrder(order.id));
  audit(actor, "order.refund", "orders", order.id, `Order #${order.orderNo} refunded ${(amountCents / 100).toFixed(2)} — ${reason}`);

  if (amountCents >= 5000) {
    notify("warning", "Large refund", `Order #${order.orderNo} refunded ${(amountCents / 100).toFixed(2)}`);
  }

  return loadOrder(order.id)!;
}

function restockOrderItems(order: string, actor: { id: string; name: string }): void {
  const db = getDb();
  const items = db.prepare(`SELECT product_id, qty FROM order_items WHERE order_id = ?`).all(order) as any[];
  for (const item of items) {
    const recipe = db.prepare(`SELECT ingredient_id, qty_per_unit FROM recipes WHERE product_id = ?`).all(item.product_id) as any[];
    for (const r of recipe) {
      const ing = db.prepare(`SELECT stock_qty, name, unit FROM ingredients WHERE id = ?`).get(r.ingredient_id) as any;
      if (!ing) continue;
      const balance = ing.stock_qty + r.qty_per_unit * item.qty;
      db.prepare(`UPDATE ingredients SET stock_qty = ?, updated_at = ? WHERE id = ?`).run(balance, now(), r.ingredient_id);
      db.prepare(
        `INSERT INTO inventory_tx (id, ingredient_id, type, delta_qty, balance_after, order_id, user_id, user_name, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(newId(), r.ingredient_id, "return", r.qty_per_unit * item.qty, balance, order, actor.id, actor.name, "refund restock", now());
    }
  }
}

export function cancelOrder(
  orderId: string,
  reason: string,
  actor: { id: string; name: string; role: string }
): Order {
  const db = getDb();
  const order = loadOrder(orderId);
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (order.status !== "open" && order.status !== "held") {
    throw Object.assign(new Error("Paid orders must be refunded, not cancelled"), { statusCode: 409 });
  }
  if (!can(actor.role, "orders.cancel")) {
    throw Object.assign(new Error("Cancel permission required"), { statusCode: 403 });
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET status='cancelled', cancelled_at=?, cancel_reason=? WHERE id=?`).run(now(), reason, order.id);
    // reverse inventory deduction
    restockOrderItems(order.id, actor);
  });
  tx();

  enqueueOutbox("orders", "update", loadOrder(order.id));
  audit(actor, "order.cancel", "orders", order.id, `Order #${order.orderNo} cancelled — ${reason}`);
  return loadOrder(order.id)!;
}

export function applyOrderDiscount(
  orderId: string,
  discountCents: number,
  actor: { id: string; name: string; role: string }
): Order {
  const db = getDb();
  const order = loadOrder(orderId);
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (order.status !== "open" && order.status !== "held") throw Object.assign(new Error("Order not editable"), { statusCode: 409 });

  const settings = getSettingJson<any>("cafe", { taxPercent: 0, serviceChargePercent: 0 });
  const totals = computeTotals(
    order.items.map((i) => ({ lineTotal: i.lineTotal, productId: i.productId })),
    {
      orderDiscount: discountCents,
      taxPercent: settings.taxPercent ?? 0,
      serviceChargePercent: settings.serviceChargePercent ?? 0,
      deliveryFee: order.totals.deliveryFee,
      productsById: new Map(order.items.map((i) => [i.productId, { taxable: true }])),
    }
  );

  db.prepare(`UPDATE orders SET order_discount_cents=?, subtotal_cents=?, taxable_base_cents=?, tax_cents=?, service_cents=?, total_cents=? WHERE id=?`)
    .run(totals.orderDiscount, totals.subtotal, totals.taxableBase, totals.tax, totals.serviceCharge, totals.total, order.id);

  enqueueOutbox("orders", "update", loadOrder(order.id));
  audit(actor, "order.discount", "orders", order.id, `Order #${order.orderNo} discount set to ${(discountCents / 100).toFixed(2)}`);
  return loadOrder(order.id)!;
}

export function holdOrder(orderId: string, label?: string): Order {
  const db = getDb();
  db.prepare(`UPDATE orders SET status='held' WHERE id=?`).run(orderId);
  void label;
  return loadOrder(orderId)!;
}

export function resumeOrder(orderId: string): Order {
  const db = getDb();
  db.prepare(`UPDATE orders SET status='open' WHERE id=? AND status='held'`).run(orderId);
  return loadOrder(orderId)!;
}

export function getSettingJson<T>(key: string, fallback: T): T {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
