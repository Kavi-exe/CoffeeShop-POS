import type { FastifyInstance } from "fastify";
import { getDb, newId, now } from "../db.js";
import { assertPerm, actorOf, type AuthedRequest } from "../plugins/auth-plugin.js";
import { audit } from "../services/audit.js";
import { enqueueOutbox } from "../services/outbox.js";
import { notify } from "../services/notify.js";
import { broadcastToPos } from "../realtime/hub.js";
import { derivedAvailability } from "../services/inventory-service.js";

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: (app as any).authHook };

  // ---------- categories ----------
  app.get("/categories", read, async () => {
    return (getDb().prepare(`SELECT * FROM categories ORDER BY sort_order`).all() as any[]).map((c) => ({
      id: c.id, name: c.name, color: c.color, icon: c.icon, sortOrder: c.sort_order,
      active: !!c.active, printerId: c.printer_id,
    }));
  });

  app.put("/categories/:id", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "products.manage");
    const { id } = request.params as any;
    const body = request.body as any;
    getDb()
      .prepare(`UPDATE categories SET name=COALESCE(?,name), color=COALESCE(?,color), icon=COALESCE(?,icon), printer_id=?, active=COALESCE(?,active) WHERE id=?`)
      .run(body.name ?? null, body.color ?? null, body.icon ?? null, body.printerId ?? null, body.active ?? null, id);
    audit(actorOf(request), "category.update", "categories", id, `Category updated: ${body.name ?? id}`);
    enqueueOutbox("categories", "update", { id, ...body });
    return { ok: true };
  });

  // ---------- products ----------
  app.get("/products", read, async (request) => {
    const includeInactive = (request.query as any)?.includeInactive === "1";
    const rows = getDb()
      .prepare(`SELECT * FROM products ${includeInactive ? "" : "WHERE active = 1"} ORDER BY category_id, sort_order`)
      .all() as any[];
    const groups = getDb().prepare(`SELECT * FROM modifier_groups ORDER BY sort_order`).all() as any[];
    const options = getDb().prepare(`SELECT * FROM modifier_options ORDER BY sort_order`).all() as any[];
    const optsByGroup = new Map<string, any[]>();
    for (const o of options) {
      if (!optsByGroup.has(o.group_id)) optsByGroup.set(o.group_id, []);
      optsByGroup.get(o.group_id)!.push({
        id: o.id, groupId: o.group_id, name: o.name, priceDelta: o.price_delta_cents, isDefault: !!o.is_default,
        sortOrder: o.sort_order, available: !!o.available,
      });
    }
    const groupsByProduct = new Map<string, any[]>();
    for (const g of groups) {
      if (!groupsByProduct.has(g.product_id)) groupsByProduct.set(g.product_id, []);
      groupsByProduct.get(g.product_id)!.push({
        id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
        sortOrder: g.sort_order, options: optsByGroup.get(g.id) ?? [],
      });
    }
    return rows.map((p) => ({
      id: p.id,
      categoryId: p.category_id,
      sku: p.sku,
      name: p.name,
      description: p.description ?? undefined,
      imageEmoji: p.image_emoji,
      imageUrl: p.image_url ?? undefined,
      price: p.price_cents,
      cost: p.cost_cents ?? undefined,
      taxable: !!p.taxable,
      available: derivedAvailability(p.id, p.available),
      allowModifiers: !!p.allow_modifiers,
      modifierGroups: groupsByProduct.get(p.id) ?? [],
      sortOrder: p.sort_order,
      active: !!p.active,
      updatedAt: p.updated_at,
    }));
  });

  app.post("/products", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "products.manage");
    const b = request.body as any;
    const id = newId();
    const at = now();
    getDb()
      .prepare(
        `INSERT INTO products (id, category_id, sku, name, description, image_emoji, price_cents, cost_cents, taxable, allow_modifiers, sort_order, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(id, b.categoryId, b.sku ?? `SKU-${id.slice(0, 6).toUpperCase()}`, b.name, b.description ?? null,
        b.imageEmoji ?? "🍽️", b.price, b.cost ?? null, b.taxable === false ? 0 : 1, b.allowModifiers ? 1 : 0,
        b.sortOrder ?? 100, at);
    audit(actorOf(request), "product.create", "products", id, `Product "${b.name}" created at ${(b.price / 100).toFixed(2)}`);
    enqueueOutbox("products", "insert", { id, name: b.name, price: b.price });
    return { id };
  });

  app.put("/products/:id", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "products.manage");
    const { id } = request.params as any;
    const b = request.body as any;
    const db = getDb();
    const before = db.prepare(`SELECT name, price_cents FROM products WHERE id = ?`).get(id) as any;
    if (!before) return reply.code(404).send({ error: "not_found" });

    db.prepare(
      `UPDATE products SET name=COALESCE(?,name), description=COALESCE(?,description), image_emoji=COALESCE(?,image_emoji),
         price_cents=COALESCE(?,price_cents), cost_cents=?, taxable=COALESCE(?,taxable),
         available=COALESCE(?,available), allow_modifiers=COALESCE(?,allow_modifiers), active=COALESCE(?,active), updated_at=?
       WHERE id=?`
    ).run(b.name ?? null, b.description ?? null, b.imageEmoji ?? null, b.price ?? null,
      b.cost ?? null, b.taxable ?? null, b.available ?? null, b.allowModifiers ?? null, b.active ?? null, now(), id);

    if (b.price != null && b.price !== before.price_cents) {
      audit(actorOf(request), "product.price_change", "products", id,
        `${user.name} changed ${before.name} price from ${(before.price_cents / 100).toFixed(2)} to ${(b.price / 100).toFixed(2)}`);
    } else {
      audit(actorOf(request), "product.update", "products", id, `Product ${before.name} updated`);
    }

    if (b.available === "out") notify("warning", "Product unavailable", `${before.name} marked out of stock`);
    enqueueOutbox("products", "update", { id, ...b });
    broadcastToPos({ type: "product.updated", productId: id, name: b.name ?? before.name, available: b.available ?? "available" });
    return { ok: true };
  });

  app.delete("/products/:id", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "products.manage");
    const { id } = request.params as any;
    // soft delete — financial integrity
    getDb().prepare(`UPDATE products SET active = 0, updated_at = ? WHERE id = ?`).run(now(), id);
    audit(actorOf(request), "product.delete", "products", id, `Product archived (soft delete)`);
    enqueueOutbox("products", "update", { id, active: false });
    return reply.code(204).send();
  });

  // ---------- modifiers ----------
  app.post("/products/:id/modifier-groups", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "products.manage");
    const { id } = request.params as any;
    const b = request.body as any;
    const gid = newId();
    getDb().prepare(`INSERT INTO modifier_groups (id, product_id, name, min_select, max_select, sort_order) VALUES (?,?,?,?,?,?)`)
      .run(gid, id, b.name, b.minSelect ?? 0, b.maxSelect ?? 1, b.sortOrder ?? 10);
    for (const [i, o] of (b.options ?? []).entries()) {
      getDb().prepare(`INSERT INTO modifier_options (id, group_id, name, price_delta_cents, is_default, sort_order) VALUES (?,?,?,?,?,?)`)
        .run(newId(), gid, o.name, o.priceDelta ?? 0, o.isDefault ? 1 : 0, i + 1);
    }
    audit(actorOf(request), "modifier.update", "products", id, `Modifier group "${b.name}" added to product`);
    return { id: gid };
  });

  // ---------- tables ----------
  app.get("/tables", read, async () => {
    return (getDb().prepare(`SELECT * FROM tables ORDER BY sort_order`).all() as any[]).map((t) => ({
      id: t.id, name: t.name, seats: t.seats, zone: t.zone, sortOrder: t.sort_order,
    }));
  });
}
