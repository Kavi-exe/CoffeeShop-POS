import { getDb } from "../db.js";
import type { AvailabilityCheck } from "@brewbean/shared";

export interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  stock_qty: number;
  min_stock_qty: number;
}

export function listIngredients(): IngredientRow[] {
  return getDb()
    .prepare("SELECT id, name, unit, stock_qty, min_stock_qty FROM ingredients WHERE archived = 0")
    .all() as IngredientRow[];
}

/** How many of `productId` can be made with current stock? (recipe-aware) */
export function makeableQty(productId: string): AvailabilityCheck {
  const db = getDb();
  const recipe = db
    .prepare(
      `SELECT r.ingredient_id, r.qty_per_unit, i.name, i.stock_qty
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.product_id = ?`
    )
    .all(productId) as Array<{ ingredient_id: string; qty_per_unit: number; name: string; stock_qty: number }>;

  if (recipe.length === 0) return { productId, makeableQty: Number.POSITIVE_INFINITY, blockers: [] };

  let makeable = Number.POSITIVE_INFINITY;
  const blockers: AvailabilityCheck["blockers"] = [];
  for (const line of recipe) {
    const canMake = line.stock_qty / line.qty_per_unit;
    if (canMake < makeable) makeable = canMake;
    if (line.stock_qty <= 0) {
      blockers.push({
        ingredientId: line.ingredient_id,
        name: line.name,
        needed: line.qty_per_unit,
        have: line.stock_qty,
      });
    }
  }
  return { productId, makeableQty: Math.floor(makeable), blockers };
}

/** Product availability derived from recipes (never blocks sale, warns POS). */
export function derivedAvailability(productId: string, manual: string): "available" | "low" | "out" {
  if (manual === "out") return "out";
  const check = makeableQty(productId);
  if (!Number.isFinite(check.makeableQty)) return manual === "low" ? "low" : "available";
  if (check.makeableQty <= 0) return "out";
  if (check.makeableQty <= 3) return "low";
  return "available";
}
