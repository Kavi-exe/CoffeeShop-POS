/** Money is always integer cents to avoid float drift. LKR cents. */
export type Cents = number;

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  active: boolean;
  printerId?: string | null; // default routing override
}

export type AvailabilityStatus = "available" | "low" | "out";

export interface Product {
  id: string;
  categoryId: string;
  sku: string;
  name: string;
  description?: string;
  imageEmoji: string; // lightweight product art (touch cards)
  imageUrl?: string;
  price: Cents;
  cost?: Cents; // purchase cost for profit reports
  taxable: boolean;
  available: AvailabilityStatus;
  allowModifiers: boolean;
  /** Embedded customization groups (catalog API returns them nested). */
  modifierGroups?: ModifierGroup[];
  sortOrder: number;
  active: boolean;
  updatedAt: string;
}

/** A customization group, e.g. Size, Milk, Sugar, Add-ons. */
export interface ModifierGroup {
  id: string;
  /** Present when the group is fetched standalone (admin CRUD). */
  productId?: string;
  name: string; // "Size" | "Milk" | "Sugar" | "Add-ons"
  minSelect: number; // 0 = optional
  maxSelect: number; // 1 = single choice, n = multi
  sortOrder: number;
  /** Options embedded when nested under a product. */
  options: ModifierOption[];
}

export interface ModifierOption {
  id: string;
  groupId: string;
  name: string; // "Small", "Low Fat", "Extra Shot"
  priceDelta: Cents; // added to base price
  isDefault: boolean;
  sortOrder: number;
  available: boolean;
}

export interface OrderItemModifier {
  optionId: string;
  groupId: string;
  groupName: string;
  name: string;
  priceDelta: Cents;
}

/** Recipe line: making 1 product consumes `qty` of ingredient (decimal). */
export interface RecipeLine {
  productId: string;
  ingredientId: string;
  qtyPerUnit: number;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string; // g, ml, pcs, …
  stockQty: number;
  minStockQty: number;
  purchasePrice: Cents; // per unit
  supplier?: string;
  updatedAt: string;
}
