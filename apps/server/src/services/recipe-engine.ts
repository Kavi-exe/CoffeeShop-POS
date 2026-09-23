import { getDb } from "../db.js";

export interface RecipeDeduction {
  ingredientId: string;
  name: string;
  unit: string;
  delta: number; // negative
  balanceAfter: number;
  shortfall: number; // positive when stock went negative
}

/**
 * Deduct ingredients for the given cart lines inside the CURRENT transaction.
 * db.transaction() wraps callers, so these statements are atomic with the
 * order insert. Negative stock is allowed but recorded as a shortfall so
 * nothing is ever silently lost — managers see it in stock alerts.
 */
export function deductForOrder(
  lines: Array<{ productId: string; qty: number }>,
  ctx: { orderId: string; userId?: string; userName?: string }
): RecipeDeduction[] {
  const db = getDb();
  const perIngredient = new Map<string, number>();

  for (const line of lines) {
    const recipe = db
      .prepare(`SELECT ingredient_id, qty_per_unit FROM recipes WHERE product_id = ?`)
      .all(line.productId) as Array<{ ingredient_id: string; qty_per_unit: number }>;
    for (const r of recipe) {
      perIngredient.set(r.ingredient_id, (perIngredient.get(r.ingredient_id) ?? 0) + r.qty_per_unit * line.qty);
    }
  }

  const results: RecipeDeduction[] = [];
  const nowIso = new Date().toISOString();

  for (const [ingredientId, qty] of perIngredient) {
    const ing = db
      .prepare(`SELECT name, unit, stock_qty FROM ingredients WHERE id = ?`)
      .get(ingredientId) as { name: string; unit: string; stock_qty: number } | undefined;
    if (!ing) continue;

    const balanceAfter = ing.stock_qty - qty;
    db.prepare(`UPDATE ingredients SET stock_qty = ?, updated_at = ? WHERE id = ?`).run(
      balanceAfter,
      nowIso,
      ingredientId
    );
    db.prepare(
      `INSERT INTO inventory_tx (id, ingredient_id, type, delta_qty, balance_after, order_id, user_id, user_name, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      crypto.randomUUID(),
      ingredientId,
      "sale",
      -qty,
      balanceAfter,
      ctx.orderId,
      ctx.userId ?? null,
      ctx.userName ?? null,
      null,
      nowIso
    );

    results.push({
      ingredientId,
      name: ing.name,
      unit: ing.unit,
      delta: -qty,
      balanceAfter,
      shortfall: balanceAfter < 0 ? -balanceAfter : 0,
    });
  }
  return results;
}

import crypto from "node:crypto";
