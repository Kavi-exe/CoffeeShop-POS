import Dexie, { type Table } from "dexie";
import type { Product, Category } from "@brewbean/shared";

export interface LocalCategory extends Category {}
export interface LocalProduct extends Product {}

/** An order created/modified locally — replayed to the server. */
export interface PendingOrder {
  id: string; // client-generated uuid (deviceOrderId on server)
  createdAt: string;
  payload: unknown; // CreateOrderInput-shaped
  state: "pending" | "sent" | "acked" | "failed";
  attempts: number;
  lastError?: string;
  /** populated once the server acks with the canonical order */
  ackedOrder?: unknown;
}

export interface SyncMeta {
  key: string; // "lastSyncAt" | etc
  value: string;
}

export interface SessionInfo {
  id: string; // singleton "current"
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; name: string; role: string };
  deviceId: string;
  deviceName: string;
  loginAt: string;
}

export interface LocalHeldOrder {
  id: string;
  label: string;
  cartJson: string;
  heldAt: string;
}

export interface LocalReceipt {
  id: string;
  orderNo: number;
  text: string;
  createdAt: string;
}

class PosDatabase extends Dexie {
  categories!: Table<LocalCategory, string>;
  products!: Table<LocalProduct, string>;
  pendingOrders!: Table<PendingOrder, string>;
  meta!: Table<SyncMeta, string>;
  session!: Table<SessionInfo, string>;
  heldOrders!: Table<LocalHeldOrder, string>;
  receipts!: Table<LocalReceipt, string>;

  constructor() {
    super("brewbean-pos");
    this.version(1).stores({
      categories: "id, sortOrder",
      products: "id, categoryId, sortOrder, active",
      pendingOrders: "id, createdAt, state",
      meta: "key",
      session: "id",
      heldOrders: "id, heldAt",
      receipts: "id, orderNo, createdAt",
    });
  }
}

export const db = new PosDatabase();
