import type { Cents, OrderItemModifier } from "./catalog.js";

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type OrderStatus =
  | "open"
  | "held"
  | "paid"
  | "completed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type PaymentMethod =
  | "cash"
  | "cash_in"
  | "cash_out"
  | "card"
  | "bank_transfer"
  | "qr"
  | "online"
  | "split";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "failed"
  | "refunded"
  | "partially_refunded";

export interface OrderTotals {
  subtotal: Cents;
  orderDiscount: Cents;
  taxableBase: Cents;
  tax: Cents;
  serviceCharge: Cents;
  deliveryFee: Cents;
  total: Cents;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  unitPrice: Cents;
  modifiers: OrderItemModifier[];
  modifiersTotal: Cents;
  unitPriceWithModifiers: Cents;
  discount: Cents;
  lineTotal: Cents;
  note?: string;
  station: "bar" | "kitchen";
  status: "queued" | "printed" | "made" | "served";
}

export interface DeliveryInfo {
  customerName: string;
  phone: string;
  address: string;
  note?: string;
  fee: Cents;
}

export interface Order {
  id: string;
  orderNo: number;
  deviceOrderId?: string;
  deviceId: string;
  type: OrderType;
  status: OrderStatus;
  tableId?: string | null;
  tableName?: string | null;
  delivery?: DeliveryInfo | null;
  customerNote?: string;
  cashierId: string;
  cashierName: string;
  items: OrderItem[];
  totals: OrderTotals;
  payments: Payment[];
  createdAt: string;
  paidAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  offlineCreated: boolean;
  syncedAt?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Cents;
  cashReceived?: Cents;
  changeGiven?: Cents;
  reference?: string;
  createdAt: string;
  splitParts?: Array<{ method: PaymentMethod; amount: Cents; reference?: string }>;
}

export interface Refund {
  id: string;
  orderId: string;
  paymentId?: string;
  amount: Cents;
  reason: string;
  method: PaymentMethod;
  userId: string;
  userName: string;
  createdAt: string;
  restock: boolean;
}

export interface Shift {
  id: string;
  userId: string;
  userName: string;
  deviceId: string;
  openingCash: Cents;
  closedAt?: string;
  countedCash?: Cents;
  expectedCash?: Cents;
  difference?: Cents;
  notes?: string;
  status: "open" | "closed";
  openedAt: string;
}

export interface ShiftMetrics {
  shiftId: string;
  cashSales: Cents;
  cardSales: Cents;
  qrSales: Cents;
  otherSales: Cents;
  totalSales: Cents;
  orderCount: number;
  refundCount: number;
  refundTotal: Cents;
  cashRefunds: Cents;
  discountTotal: Cents;
  expectedCash: Cents;
}

export interface HeldOrder {
  id: string;
  order: Order;
  heldAt: string;
  label?: string;
}

export function computeTotals(
  items: Array<{ lineTotal: Cents; productId: string }>,
  opts: {
    orderDiscount: Cents;
    taxPercent: number;
    serviceChargePercent: number;
    deliveryFee: Cents;
    productsById: Map<string, { taxable: boolean }>;
  }
): OrderTotals {
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const orderDiscount = Math.min(Math.max(0, opts.orderDiscount), subtotal);
  const afterDiscount = subtotal - orderDiscount;
  const taxableShare =
    subtotal > 0
      ? items
          .filter((i) => opts.productsById.get(i.productId)?.taxable !== false)
          .reduce((s, i) => s + i.lineTotal, 0)
      : 0;
  const taxableBase =
    subtotal > 0 ? Math.round(afterDiscount * (taxableShare / subtotal)) : 0;
  const tax = Math.round((taxableBase * opts.taxPercent) / 100);
  const serviceCharge = Math.round((afterDiscount * opts.serviceChargePercent) / 100);
  const total = afterDiscount + tax + serviceCharge + opts.deliveryFee;
  return {
    subtotal,
    orderDiscount,
    taxableBase,
    tax,
    serviceCharge,
    deliveryFee: opts.deliveryFee,
    total,
  };
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  cash_in: "Cash In",
  cash_out: "Cash Out",
  card: "Card",
  bank_transfer: "Bank Transfer",
  qr: "QR Payment",
  online: "Online",
  split: "Split",
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine-In",
  takeaway: "Takeaway",
  delivery: "Delivery",
};
