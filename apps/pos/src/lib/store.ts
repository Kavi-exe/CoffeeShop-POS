import { create } from "zustand";
import type { Category, Product, OrderTotals, OrderType, OrderItemModifier, Order } from "@brewbean/shared";
import { computeTotals } from "@brewbean/shared";
import { db } from "./local-db.js";
import { configureApi } from "./api.js";
import { queueOrder, onSyncStateChange } from "./sync-manager.js";
import { printFallback, receiptText } from "./printer-bridge.js";

export interface CartLine {
  lineId: string;
  productId: string;
  qty: number;
  modifierOptionIds: string[];
  discountCents: number;
  note?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; name: string; role: string };
  deviceId: string;
  deviceName: string;
}

interface PosState {
  session: Session | null;
  categories: Category[];
  products: Product[];
  online: boolean;
  pendingCount: number;
  orderType: OrderType;
  tableId: string | null;
  cart: CartLine[];
  orderDiscountCents: number;
  customerNote: string;
  deliveryInfo: { customerName: string; phone: string; address: string; note?: string; feeCents: number } | null;
  lastReceipt: { text: string; orderNo: number } | null;
  shiftOpen: boolean;

  setSession(s: Session | null): void;
  loadCatalog(): Promise<void>;
  setSyncState(online: boolean, pending: number): void;
  setOrderType(t: OrderType): void;
  setTable(id: string | null): void;
  addProduct(p: Product, optionIds: string[]): void;
  incLine(lineId: string, delta: number): void;
  setLineDiscount(lineId: string, cents: number): void;
  setLineNote(lineId: string, note: string): void;
  removeLine(lineId: string): void;
  clearCart(): void;
  setOrderDiscount(cents: number): void;
  setCustomerNote(note: string): void;
  setDeliveryInfo(info: PosState["deliveryInfo"]): void;
  totals(taxPercent: number, servicePercent: number): OrderTotals;
  submitOrder(): Promise<{ localId: string; queuedOffline: boolean }>;
}

export const usePos = create<PosState>((set, get) => ({
  session: null,
  categories: [],
  products: [],
  online: navigator.onLine,
  pendingCount: 0,
  orderType: "takeaway",
  tableId: null,
  cart: [],
  orderDiscountCents: 0,
  customerNote: "",
  deliveryInfo: null,
  lastReceipt: null,
  shiftOpen: false,

  async setSession(s) {
    if (s) {
      await db.session.put({ id: "current", ...s, loginAt: new Date().toISOString() });
      configureApi({
        get: () => {
          const cur = usePos.getState().session;
          return {
            accessToken: cur?.accessToken ?? "",
            refreshToken: cur?.refreshToken ?? s.refreshToken,
          };
        },
        onRefreshed: (accessToken, refreshToken) =>
          usePos.setState((st) => (st.session ? { session: { ...st.session, accessToken, refreshToken } } : st)),
        onAuthFailure: () => usePos.getState().setSession(null),
      });
    } else {
      await db.session.clear();
      set({ session: null });
    }
    set({ session: s });
  },

  async loadCatalog() {
    const [categories, products] = await Promise.all([db.categories.toArray(), db.products.toArray()]);
    set({
      categories: categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder),
      products: products.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder),
    });
  },

  setSyncState(online, pending) {
    set({ online, pendingCount: pending });
  },

  setOrderType(t) {
    set({ orderType: t, tableId: null });
  },

  setTable(id) {
    set({ tableId: id });
  },

  addProduct(p, optionIds) {
    const key = (ids: string[]) => `${p.id}|${[...ids].sort().join(",")}`;
    const existing = get().cart.find(
      (l) => l.productId === p.id && key(l.modifierOptionIds) === key(optionIds)
    );
    if (existing) {
      set({ cart: get().cart.map((l) => (l.lineId === existing.lineId ? { ...l, qty: l.qty + 1 } : l)) });
    } else {
      set({
        cart: [
          ...get().cart,
          {
            lineId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            productId: p.id,
            qty: 1,
            modifierOptionIds: optionIds,
            discountCents: 0,
          },
        ],
      });
    }
  },

  incLine(lineId, delta) {
    set({
      cart: get()
        .cart.map((l) => (l.lineId === lineId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    });
  },

  setLineDiscount(lineId, cents) {
    set({ cart: get().cart.map((l) => (l.lineId === lineId ? { ...l, discountCents: Math.max(0, cents) } : l)) });
  },

  setLineNote(lineId, note) {
    set({ cart: get().cart.map((l) => (l.lineId === lineId ? { ...l, note } : l)) });
  },

  removeLine(lineId) {
    set({ cart: get().cart.filter((l) => l.lineId !== lineId) });
  },

  clearCart() {
    set({ cart: [], orderDiscountCents: 0, customerNote: "", tableId: null, deliveryInfo: null });
  },

  setOrderDiscount(cents) {
    set({ orderDiscountCents: Math.max(0, cents) });
  },

  setCustomerNote(note) {
    set({ customerNote: note });
  },

  setDeliveryInfo(info) {
    set({ deliveryInfo: info });
  },

  totals(taxPercent, servicePercent) {
    const { cart, products, orderDiscountCents, deliveryInfo } = get();
    const lines = cart.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      const modsTotal = (p?.modifierGroups ?? []).flatMap((g) => g.options)
        .filter((o) => l.modifierOptionIds.includes(o.id))
        .reduce((s, o) => s + o.priceDelta, 0);
      const unit = (p?.price ?? 0) + modsTotal;
      return { lineTotal: unit * l.qty - l.discountCents, productId: l.productId };
    });
    return computeTotals(lines, {
      orderDiscount: orderDiscountCents,
      taxPercent,
      serviceChargePercent: servicePercent,
      deliveryFee: get().orderType === "delivery" ? (deliveryInfo?.feeCents ?? 0) : 0,
      productsById: new Map(products.map((p) => [p.id, { taxable: p.taxable }])),
    });
  },

  async submitOrder() {
    const st = get();
    if (!st.session) throw new Error("Not logged in");
    if (st.cart.length === 0) throw new Error("Cart is empty");

    const localId = crypto.randomUUID();
    const totals = st.totals(0, 0); // server recomputes authoritatively
    void totals;

    const payload = {
      deviceOrderId: localId,
      deviceId: st.session.deviceId,
      type: st.orderType,
      tableId: st.orderType === "dine_in" ? st.tableId : null,
      delivery:
        st.orderType === "delivery"
          ? {
              customerName: st.deliveryInfo?.customerName ?? "",
              phone: st.deliveryInfo?.phone ?? "",
              address: st.deliveryInfo?.address ?? "",
              note: st.deliveryInfo?.note,
              feeCents: st.deliveryInfo?.feeCents ?? 0,
            }
          : null,
      customerNote: st.customerNote || undefined,
      lines: st.cart.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        modifierOptionIds: l.modifierOptionIds,
        discountCents: l.discountCents,
        note: l.note,
      })),
      orderDiscountCents: st.orderDiscountCents,
      offlineCreated: !st.online,
    };

    await queueOrder(payload, localId);
    return { localId, queuedOffline: !st.online };
  },
}));

export function buildReceipt(order: any, cafe: { name: string; address?: string; phone?: string; footer: string }): string {
  return receiptText(order as Order, cafe);
}

export function openReceiptWindow(order: any, cafe: { name: string; address?: string; phone?: string; footer: string }): void {
  printFallback(receiptText(order as Order, cafe));
}

export function watchSync(): () => void {
  return onSyncStateChange((online, pending) => {
    usePos.getState().setSyncState(online, pending);
    // After each successful sync pass the local catalog may have changed —
    // re-read it from Dexie so the UI stays fresh (cheap: ~dozens of rows).
    if (online) void usePos.getState().loadCatalog();
  });
}

export function optionLabel(mods: OrderItemModifier[]): string {
  return mods.map((m) => m.name).join(", ");
}
