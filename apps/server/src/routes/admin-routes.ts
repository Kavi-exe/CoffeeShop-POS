import type { FastifyInstance } from "fastify";
import { getDb, newId, now } from "../db.js";
import { assertPerm, actorOf, type AuthedRequest } from "../plugins/auth-plugin.js";
import { audit } from "../services/audit.js";
import { hashPassword } from "../services/auth.js";
import { listPrinters, upsertPrinter, testPrint, setPrinterStatus, getPrinter } from "../services/printer-service.js";
import { getCafeSettings, setSettingJson } from "../services/settings-service.js";
import {
  dailySales, hourlySales, todaySummary, topProducts, categoryPerformance,
  paymentBreakdown, cashierReport, lowStockItems, listOrders,
} from "../services/report-service.js";
import { syncStatus } from "../services/sync-engine.js";
import { revokeAllRefreshTokens } from "../services/auth.js";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: (app as any).authHook };

  // ---------- printers ----------
  app.get("/printers", read, async () => listPrinters());

  app.put("/printers/:id", read, async (request: AuthedRequest) => {
    const user = assertPerm(request, "printers.manage");
    const { id } = request.params as any;
    const body = request.body as any;
    return upsertPrinter({ ...body, id }, actorOf(request));
  });

  app.post("/printers/:id/test", read, async (request: AuthedRequest) => {
    assertPerm(request, "printers.manage");
    const { id } = request.params as any;
    return testPrint(id, actorOf(request));
  });

  app.post("/printers/:id/status", read, async (request: AuthedRequest) => {
    assertPerm(request, "printers.manage");
    const { id } = request.params as any;
    const { status } = request.body as { status: "online" | "offline" | "error" };
    setPrinterStatus(id, status);
    return { ok: true };
  });

  // ---------- users ----------
  app.get("/users", read, async (request: AuthedRequest) => {
    assertPerm(request, "users.manage");
    return (getDb().prepare(`SELECT id, username, display_name, role, active, created_at FROM users ORDER BY username`).all() as any[]).map((u) => ({
      id: u.id, username: u.username, name: u.display_name, role: u.role, active: !!u.active, createdAt: u.created_at,
    }));
  });

  app.post("/users", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "users.manage");
    const b = request.body as any;
    const id = newId();
    const at = now();
    getDb()
      .prepare(`INSERT INTO users (id, username, display_name, pin_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, b.username, b.name, hashPassword(b.password), b.role ?? "cashier", at, at);
    audit(actorOf(request), "user.create", "users", id, `User "${b.username}" created with role ${b.role ?? "cashier"}`);
    return { id };
  });

  app.put("/users/:id", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "users.manage");
    const { id } = request.params as any;
    const b = request.body as any;
    const db = getDb();
    db.prepare(`UPDATE users SET display_name=COALESCE(?,display_name), role=COALESCE(?,role), active=COALESCE(?,active), updated_at=? WHERE id=?`)
      .run(b.name ?? null, b.role ?? null, b.active ?? null, now(), id);
    if (b.password) {
      db.prepare(`UPDATE users SET pin_hash = ? WHERE id = ?`).run(hashPassword(b.password), id);
      revokeAllRefreshTokens(id);
    }
    if (b.active === false) revokeAllRefreshTokens(id);
    audit(actorOf(request), b.active === false ? "user.deactivate" : "user.update", "users", id, `User ${b.name ?? id} updated`);
    return { ok: true };
  });

  // ---------- settings ----------
  app.get("/settings", read, async () => getCafeSettings());

  app.put("/settings", read, async (request: AuthedRequest) => {
    assertPerm(request, "settings.manage");
    const b = request.body as any;
    const merged = { ...getCafeSettings(), ...b };
    setSettingJson("cafe", merged);
    audit(actorOf(request), "settings.update", "settings", "cafe", `Cafe settings updated`);
    return merged;
  });

  // ---------- reports ----------
  app.get("/reports/summary", read, async () => todaySummary());

  app.get("/reports/daily", read, async (request) => {
    assertPerm(request, "reports.read");
    const days = Number((request.query as any)?.days ?? 14);
    return dailySales(days);
  });

  app.get("/reports/hourly", read, async (request) => {
    assertPerm(request, "reports.read");
    return hourlySales((request.query as any)?.date);
  });

  app.get("/reports/top-products", read, async (request) => {
    assertPerm(request, "reports.read");
    return topProducts(Number((request.query as any)?.days ?? 30), Number((request.query as any)?.limit ?? 10));
  });

  app.get("/reports/categories", read, async (request) => {
    assertPerm(request, "reports.read");
    return categoryPerformance(Number((request.query as any)?.days ?? 30));
  });

  app.get("/reports/payments", read, async (request) => {
    assertPerm(request, "reports.read");
    return paymentBreakdown(Number((request.query as any)?.days ?? 30));
  });

  app.get("/reports/cashiers", read, async (request) => {
    assertPerm(request, "reports.read");
    return cashierReport(Number((request.query as any)?.days ?? 30));
  });

  // ---------- audit ----------
  app.get("/audit", read, async (request: AuthedRequest) => {
    assertPerm(request, "audit.read");
    const limit = Number((request.query as any)?.limit ?? 100);
    return (getDb().prepare(`SELECT * FROM audit_log ORDER BY at DESC LIMIT ?`).all(limit) as any[]).map((a) => ({
      id: a.id, at: a.at, userName: a.user_name, role: a.role, action: a.action,
      entity: a.entity, entityId: a.entity_id, detail: a.detail,
    }));
  });

  // ---------- notifications ----------
  app.get("/notifications", read, async () => {
    return (getDb().prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`).all() as any[]).map((n) => ({
      id: n.id, severity: n.severity, title: n.title, body: n.body, read: !!n.read, at: n.created_at,
    }));
  });

  app.post("/notifications/read-all", read, async () => {
    getDb().prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
    return { ok: true };
  });

  // ---------- sync ----------
  app.get("/sync/status", read, async () => syncStatus());

  app.post("/sync/flush", read, async (request: AuthedRequest) => {
    assertPerm(request, "settings.manage");
    const { startSyncEngine } = await import("../services/sync-engine.js");
    void startSyncEngine();
    return { ok: true };
  });

  // ---------- held orders ----------
  app.get("/orders/held", read, async () => {
    return (getDb().prepare(`SELECT id, order_no, table_name, total_cents, created_at FROM orders WHERE status = 'held' ORDER BY created_at`).all() as any[]).map((o) => ({
      id: o.id, orderNo: o.order_no, tableName: o.table_name, total: o.total_cents, createdAt: o.created_at,
    }));
  });
}
