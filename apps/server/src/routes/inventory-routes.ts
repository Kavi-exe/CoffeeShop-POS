import type { FastifyInstance } from "fastify";
import { getDb, newId, now } from "../db.js";
import { assertPerm, actorOf, type AuthedRequest } from "../plugins/auth-plugin.js";
import { audit } from "../services/audit.js";
import { enqueueOutbox } from "../services/outbox.js";
import { notify } from "../services/notify.js";
import { listIngredients } from "../services/inventory-service.js";

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: (app as any).authHook };

  app.get("/ingredients", read, async () => {
    return listIngredients().map((i) => ({
      id: i.id, name: i.name, unit: i.unit, stockQty: i.stock_qty, minStockQty: i.min_stock_qty,
      status: i.stock_qty <= 0 ? "out" : i.stock_qty <= i.min_stock_qty ? "low" : "ok",
    }));
  });

  app.post("/ingredients", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "inventory.manage");
    const b = request.body as any;
    const id = newId();
    getDb()
      .prepare(
        `INSERT INTO ingredients (id, name, unit, stock_qty, min_stock_qty, purchase_price_cents, supplier, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(id, b.name, b.unit ?? "pcs", b.stockQty ?? 0, b.minStockQty ?? 0, b.purchasePrice ?? 0, b.supplier ?? null, now());
    audit(actorOf(request), "inventory.adjust", "ingredients", id, `Ingredient "${b.name}" created`);
    return { id };
  });

  app.put("/ingredients/:id", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "inventory.manage");
    const { id } = request.params as any;
    const b = request.body as any;
    getDb()
      .prepare(
        `UPDATE ingredients SET name=COALESCE(?,name), unit=COALESCE(?,unit), min_stock_qty=COALESCE(?,min_stock_qty),
           purchase_price_cents=COALESCE(?,purchase_price_cents), supplier=COALESCE(?,supplier), updated_at=? WHERE id=?`
      )
      .run(b.name ?? null, b.unit ?? null, b.minStockQty ?? null, b.purchasePrice ?? null, b.supplier ?? null, now(), id);
    audit(actorOf(request), "inventory.adjust", "ingredients", id, `Ingredient ${b.name ?? id} updated`);
    return { ok: true };
  });

  app.post("/ingredients/:id/adjust", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "inventory.manage");
    const { id } = request.params as any;
    const { deltaQty, type, note } = request.body as { deltaQty: number; type: "purchase" | "adjustment" | "waste" | "damage" | "stock_count"; note?: string };
    const db = getDb();
    const ing = db.prepare(`SELECT * FROM ingredients WHERE id = ?`).get(id) as any;
    if (!ing) return reply.code(404).send({ error: "not_found" });

    let balance: number;
    if (type === "stock_count") {
      balance = deltaQty; // absolute count
    } else {
      balance = ing.stock_qty + deltaQty;
    }

    const tx = db.transaction(() => {
      db.prepare(`UPDATE ingredients SET stock_qty = ?, updated_at = ? WHERE id = ?`).run(balance, now(), id);
      db.prepare(
        `INSERT INTO inventory_tx (id, ingredient_id, type, delta_qty, balance_after, user_id, user_name, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(newId(), id, type, balance - ing.stock_qty, balance, user.sub, user.name, note ?? null, now());
    });
    tx();

    audit(actorOf(request), type === "waste" ? "inventory.waste" : "inventory.adjust", "ingredients", id,
      `${type} ${balance - ing.stock_qty}${ing.unit} — ${ing.name} now ${balance}${ing.unit}`);

    if (balance <= 0) notify("critical", "Out of stock", `${ing.name} depleted`);
    else if (balance <= ing.min_stock_qty) notify("warning", "Low stock", `${ing.name} at ${balance}${ing.unit}`);

    enqueueOutbox("inventory_transactions", "insert", { ingredientId: id, deltaQty: balance - ing.stock_qty, balanceAfter: balance, at: now() });
    return { balanceAfter: balance };
  });

  app.get("/ingredients/:id/history", read, async (request) => {
    const { id } = request.params as any;
    const rows = getDb()
      .prepare(`SELECT * FROM inventory_tx WHERE ingredient_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(id) as any[];
    return rows.map((r) => ({
      id: r.id, type: r.type, deltaQty: r.delta_qty, balanceAfter: r.balance_after,
      orderId: r.order_id, userName: r.user_name, note: r.note, createdAt: r.created_at,
    }));
  });

  app.get("/inventory/low-stock", read, async () => {
    const rows = getDb()
      .prepare(
        `SELECT id, name, unit, stock_qty, min_stock_qty FROM ingredients
         WHERE archived = 0 AND stock_qty <= min_stock_qty
         ORDER BY stock_qty ASC`
      )
      .all() as any[];
    return rows.map((r) => ({
      id: r.id, name: r.name, unit: r.unit, stockQty: r.stock_qty, minStockQty: r.min_stock_qty,
      status: r.stock_qty <= 0 ? "out" : "low",
    }));
  });
}
