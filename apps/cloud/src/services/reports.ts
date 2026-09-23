import { query } from "../db.js";

export async function todaySummary(): Promise<any> {
  const totals = await query(
    `SELECT COALESCE(SUM(total_cents),0) revenue, COUNT(*) orders,
            COALESCE(SUM(cost_cents),0) cost, COALESCE(SUM(order_discount_cents),0) discounts
     FROM cloud_orders
     WHERE status IN ('completed','paid','partially_refunded')
       AND created_at >= date_trunc('day', now())`
  );
  const byMethod = await query(
    `SELECT p->>'method' method, SUM((p->>'amount')::bigint) amount
     FROM cloud_orders o, jsonb_array_elements(o.payments_json) p
     WHERE o.status IN ('completed','paid','partially_refunded')
       AND o.created_at >= date_trunc('day', now())
     GROUP BY 1`
  );
  const openOrders = await query(
    `SELECT COUNT(*) c FROM cloud_orders WHERE status IN ('open','held') AND created_at >= now() - interval '1 day'`
  );
  const t = totals.rows[0];
  const methodMap: Record<string, number> = {};
  for (const m of byMethod.rows) methodMap[m.method] = Number(m.amount);
  const revenue = Number(t.revenue);
  return {
    revenue,
    orders: Number(t.orders),
    avgOrderValue: Number(t.orders) > 0 ? Math.round(revenue / Number(t.orders)) : 0,
    cashSales: methodMap["cash"] ?? 0,
    cardSales: (methodMap["card"] ?? 0) + (methodMap["bank_transfer"] ?? 0),
    onlineSales: (methodMap["qr"] ?? 0) + (methodMap["online"] ?? 0),
    discounts: Number(t.discounts),
    estimatedProfit: revenue - Number(t.cost) - Number(t.discounts),
    activeOrders: Number(openOrders.rows[0].c),
  };
}

export async function dailySales(days: number): Promise<any[]> {
  const r = await query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') date,
            SUM(total_cents) revenue, COUNT(*) orders
     FROM cloud_orders
     WHERE status IN ('completed','paid','partially_refunded')
       AND created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [String(days)]
  );
  return r.rows.map((x) => ({ date: x.date, revenue: Number(x.revenue), orders: Number(x.orders) }));
}

export async function hourlySales(): Promise<any[]> {
  const r = await query(
    `SELECT EXTRACT(HOUR FROM created_at)::int hour, SUM(total_cents) revenue, COUNT(*) orders
     FROM cloud_orders
     WHERE status IN ('completed','paid','partially_refunded') AND created_at >= date_trunc('day', now())
     GROUP BY 1 ORDER BY 1`
  );
  return r.rows.map((x) => ({ hour: Number(x.hour), revenue: Number(x.revenue), orders: Number(x.orders) }));
}

export async function topProducts(days: number, limit: number): Promise<any[]> {
  const r = await query(
    `SELECT item->>'productId' id, item->>'productName' name,
            SUM((item->>'qty')::numeric) qty, SUM((item->>'lineTotal')::bigint) revenue
     FROM cloud_orders o, jsonb_array_elements(o.items_json) item
     WHERE o.status IN ('completed','paid','partially_refunded')
       AND o.created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1,2 ORDER BY revenue DESC LIMIT $2`,
    [String(days), limit]
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, qty: Number(x.qty), revenue: Number(x.revenue) }));
}

export async function categoryPerformance(days: number): Promise<any[]> {
  const r = await query(
    `SELECT COALESCE(c.name,'Other') category, SUM((item->>'qty')::numeric) qty, SUM((item->>'lineTotal')::bigint) revenue
     FROM cloud_orders o
     JOIN cloud_products p ON p.id = item->>'productId', jsonb_array_elements(o.items_json) item
     LEFT JOIN cloud_categories c ON c.id = p.category_id
     WHERE o.status IN ('completed','paid','partially_refunded')
       AND o.created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY revenue DESC`,
    [String(days)]
  );
  return r.rows.map((x) => ({ category: x.category, qty: Number(x.qty), revenue: Number(x.revenue) }));
}

export async function paymentBreakdown(days: number): Promise<any[]> {
  const r = await query(
    `SELECT p->>'method' method, SUM((p->>'amount')::bigint) revenue, COUNT(*) count
     FROM cloud_orders o, jsonb_array_elements(o.payments_json) p
     WHERE o.status IN ('completed','paid','partially_refunded')
       AND o.created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY revenue DESC`,
    [String(days)]
  );
  return r.rows.map((x) => ({ method: x.method, revenue: Number(x.revenue), count: Number(x.count) }));
}

export async function cashierReport(days: number): Promise<any[]> {
  const r = await query(
    `SELECT cashier_name name, COUNT(*) orders, SUM(total_cents) sales, SUM(order_discount_cents) discounts
     FROM cloud_orders
     WHERE status IN ('completed','paid','partially_refunded')
       AND created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY sales DESC`,
    [String(days)]
  );
  return r.rows.map((x) => ({ name: x.name, orders: Number(x.orders), sales: Number(x.sales), discounts: Number(x.discounts) }));
}

export async function lowStock(): Promise<any[]> {
  const r = await query(
    `SELECT id, name, unit, stock_qty "stockQty", min_stock_qty "minStockQty",
       CASE WHEN stock_qty <= 0 THEN 'out' WHEN stock_qty <= min_stock_qty THEN 'low' ELSE 'ok' END status
     FROM cloud_ingredients WHERE archived = FALSE
     ORDER BY CASE WHEN stock_qty <= 0 THEN 0 WHEN stock_qty <= min_stock_qty THEN 1 ELSE 2 END, name`
  );
  return r.rows;
}

export async function recentOrders(limit: number): Promise<any[]> {
  const r = await query(
    `SELECT id, order_no "orderNo", type, status, cashier_name "cashierName", table_name "tableName",
            total_cents total, created_at "createdAt", device_id "deviceId"
     FROM cloud_orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

export async function deviceStatus(): Promise<any[]> {
  const r = await query(
    `SELECT id, name, kind, last_seen_at "lastSeenAt", online,
            (last_seen_at > now() - interval '2 minutes') "reachable"
     FROM cloud_devices ORDER BY kind, id`
  );
  return r.rows;
}

export async function printerStatus(): Promise<any[]> {
  const r = await query(
    `SELECT id, name, kind, status, last_seen_at "lastSeenAt", enabled FROM cloud_printers ORDER BY kind, name`
  );
  return r.rows;
}

export async function listAudit(limit: number): Promise<any[]> {
  const r = await query(
    `SELECT id, at, user_name "userName", role, action, entity, detail, source
     FROM cloud_audit ORDER BY at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

export async function listNotifications(limit: number): Promise<any[]> {
  const r = await query(
    `SELECT id, severity, title, body, read, created_at "createdAt"
     FROM cloud_notifications ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}
