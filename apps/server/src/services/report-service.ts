import { getDb } from "../db.js";

export interface ListOrdersOpts {
  status?: string;
  cashierId?: string;
  limit?: number;
  offset?: number;
}

export function listOrders(opts: ListOrdersOpts): any[] {
  const clauses: string[] = [];
  const params: any[] = [];
  if (opts.status) {
    clauses.push("o.status = ?");
    params.push(opts.status);
  }
  if (opts.cashierId) {
    clauses.push("o.cashier_id = ?");
    params.push(opts.cashierId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 50, opts.offset ?? 0);
  return (
    getDb()
      .prepare(
        `SELECT o.id, o.order_no, o.type, o.status, o.table_name, o.cashier_name, o.total_cents,
                o.created_at, o.device_id
         FROM orders o ${where}
         ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params) as any[]
  ).map((r) => ({
    id: r.id, orderNo: r.order_no, type: r.type, status: r.status, tableName: r.table_name,
    cashierName: r.cashier_name, total: r.total_cents, createdAt: r.created_at, deviceId: r.device_id,
  }));
}

export function dailySales(days: number): Array<{ date: string; revenue: number; orders: number }> {
  const rows = getDb()
    .prepare(
      `SELECT date(created_at) d, SUM(total_cents) rev, COUNT(*) cnt
       FROM orders WHERE status IN ('completed','paid','partially_refunded')
         AND created_at >= date('now', ?)
       GROUP BY d ORDER BY d`
    )
    .all(`-${days} days`) as any[];
  return rows.map((r) => ({ date: r.d, revenue: r.rev, orders: r.cnt }));
}

export function hourlySales(date?: string): Array<{ hour: number; revenue: number; orders: number }> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const rows = getDb()
    .prepare(
      `SELECT CAST(strftime('%H', created_at) AS INT) h, SUM(total_cents) rev, COUNT(*) cnt
       FROM orders WHERE status IN ('completed','paid','partially_refunded') AND date(created_at) = ?
       GROUP BY h ORDER BY h`
    )
    .all(day) as any[];
  return rows.map((r) => ({ hour: r.h, revenue: r.rev, orders: r.cnt }));
}

export function todaySummary(): any {
  const db = getDb();
  const statusIn = `('completed','paid','partially_refunded')`;
  const today = `date('now')`;
  const base = `FROM orders WHERE status IN ${statusIn} AND date(created_at) = ${today}`;

  const totals = db.prepare(`SELECT COALESCE(SUM(total_cents),0) rev, COUNT(*) cnt FROM orders WHERE status IN ${statusIn} AND date(created_at) = ${today}`).get() as any;
  void base;
  const byMethod = db
    .prepare(
      `SELECT p.method, COALESCE(SUM(p.amount_cents),0) s
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE o.status IN ${statusIn} AND date(o.created_at) = ${today}
       GROUP BY p.method`
    )
    .all() as any[];
  const discounts = db.prepare(`SELECT COALESCE(SUM(order_discount_cents),0) s FROM orders WHERE status IN ${statusIn} AND date(created_at) = ${today}`).get() as any;
  const cost = db.prepare(`SELECT COALESCE(SUM(cost_cents),0) s FROM orders WHERE status IN ${statusIn} AND date(created_at) = ${today}`).get() as any;
  const openOrders = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('open','held')`).get() as any;
  const profit = (totals.rev ?? 0) - (cost.s ?? 0) - (discounts.s ?? 0);

  const cash = byMethod.find((m) => m.method === "cash")?.s ?? 0;
  const card = byMethod.filter((m) => m.method === "card" || m.method === "bank_transfer").reduce((s, m) => s + m.s, 0);
  const online = byMethod.filter((m) => ["qr", "online"].includes(m.method)).reduce((s, m) => s + m.s, 0);

  return {
    revenue: totals.rev,
    orders: totals.cnt,
    avgOrderValue: totals.cnt > 0 ? Math.round(totals.rev / totals.cnt) : 0,
    cashSales: cash,
    cardSales: card,
    onlineSales: online,
    discounts: discounts.s,
    estimatedProfit: profit,
    activeOrders: openOrders.c,
  };
}

export function topProducts(days: number, limit = 10): any[] {
  return (
    getDb()
      .prepare(
        `SELECT oi.product_id id, oi.product_name name, SUM(oi.qty) qty, SUM(oi.line_total_cents) revenue,
                c.name category
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE o.status IN ('completed','paid','partially_refunded') AND o.created_at >= date('now', ?)
         GROUP BY oi.product_id, oi.product_name
         ORDER BY revenue DESC LIMIT ?`
      )
      .all(`-${days} days`, limit) as any[]
  ).map((r) => ({ id: r.id, name: r.name, qty: r.qty, revenue: r.revenue, category: r.category }));
}

export function categoryPerformance(days: number): any[] {
  return (
    getDb()
      .prepare(
        `SELECT c.name category, SUM(oi.qty) qty, SUM(oi.line_total_cents) revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE o.status IN ('completed','paid','partially_refunded') AND o.created_at >= date('now', ?)
         GROUP BY c.name ORDER BY revenue DESC`
      )
      .all(`-${days} days`) as any[]
  );
}

export function paymentBreakdown(days: number): any[] {
  return (
    getDb()
      .prepare(
        `SELECT p.method, SUM(p.amount_cents) revenue, COUNT(*) count
         FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE o.status IN ('completed','paid','partially_refunded') AND o.created_at >= date('now', ?)
         GROUP BY p.method ORDER BY revenue DESC`
      )
      .all(`-${days} days`) as any[]
  );
}

export function cashierReport(days: number): any[] {
  return (
    getDb()
      .prepare(
        `SELECT o.cashier_id id, o.cashier_name name, COUNT(*) orders, COALESCE(SUM(o.total_cents),0) sales,
                COALESCE(SUM(o.order_discount_cents),0) discounts
         FROM orders o
         WHERE o.status IN ('completed','paid','partially_refunded') AND o.created_at >= date('now', ?)
         GROUP BY o.cashier_id, o.cashier_name ORDER BY sales DESC`
      )
      .all(`-${days} days`) as any[]
  );
}

export function lowStockItems(): any[] {
  return (
    getDb()
      .prepare(
        `SELECT id, name, unit, stock_qty, min_stock_qty,
          CASE WHEN stock_qty <= 0 THEN 'out' WHEN stock_qty <= min_stock_qty THEN 'low' ELSE 'ok' END status
         FROM ingredients WHERE archived = 0
         ORDER BY CASE WHEN stock_qty <= 0 THEN 0 WHEN stock_qty <= min_stock_qty THEN 1 ELSE 2 END, name`
      )
      .all() as any[]
  ).map((r) => ({
    id: r.id, name: r.name, unit: r.unit, stockQty: r.stock_qty, minStockQty: r.min_stock_qty, status: r.status,
  }));
}
