import type { Cents } from "./catalog.js";

export type InventoryTxType =
  | "sale" // deducted by recipe on order completion
  | "purchase"
  | "adjustment"
  | "waste"
  | "damage"
  | "stock_count"
  | "return";

export interface InventoryTransaction {
  id: string;
  ingredientId: string;
  type: InventoryTxType;
  /** Signed delta in ingredient units (+ adds stock, − removes). */
  deltaQty: number;
  /** Stock quantity after applying this transaction. */
  balanceAfter: number;
  orderId?: string;
  userId?: string;
  userName?: string;
  note?: string;
  unitCost?: Cents;
  createdAt: string;
}

export interface StockStatus {
  ingredientId: string;
  name: string;
  unit: string;
  stockQty: number;
  minStockQty: number;
  status: "ok" | "low" | "out";
}

export function stockStatusOf(stockQty: number, minStockQty: number): StockStatus["status"] {
  if (stockQty <= 0) return "out";
  if (stockQty <= minStockQty) return "low";
  return "ok";
}

/** Commit check: can we make `qty` of each product right now? */
export interface AvailabilityCheck {
  productId: string;
  makeableQty: number; // limited by scarcest ingredient
  blockers: Array<{ ingredientId: string; name: string; needed: number; have: number }>;
}
