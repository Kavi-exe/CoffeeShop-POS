/** Realtime events (WebSocket local / SSE cloud). Discriminated union. */

export type RealtimeEvent =
  | { type: "order.created"; order: OrderSnapshot }
  | { type: "order.updated"; order: OrderSnapshot }
  | { type: "order.paid"; orderId: string; orderNo: number; total: number; deviceId: string }
  | { type: "order.cancelled"; orderId: string; orderNo: number; reason: string }
  | { type: "sale.completed"; order: OrderSnapshot }
  | { type: "inventory.low"; ingredientId: string; name: string; qty: number; unit: string }
  | { type: "inventory.out"; ingredientId: string; name: string; unit: string }
  | { type: "inventory.changed"; ingredientId: string; qty: number }
  | { type: "product.updated"; productId: string; name: string; available: string }
  | { type: "printer.status"; printerId: string; name: string; status: "online" | "offline" | "error"; detail?: string }
  | { type: "printer.job"; printerId: string; orderId: string; orderNo: number; station: string; status: "queued" | "printed" | "failed" }
  | { type: "device.status"; deviceId: string; name: string; online: boolean; lastSeenAt: string }
  | { type: "shift.opened" | "shift.closed"; shiftId: string; userName: string }
  | { type: "sync.status"; pendingCount: number; lastSyncAt?: string; error?: string }
  | { type: "notification"; id: string; severity: "info" | "warning" | "critical"; title: string; body: string; at: string }
  | { type: "hello"; serverTime: string };

/** Trimmed order for event payloads — keeps sockets light. */
export interface OrderSnapshot {
  id: string;
  orderNo: number;
  deviceId: string;
  type: string;
  status: string;
  total: number;
  itemCount: number;
  cashierName: string;
  tableName?: string | null;
  createdAt: string;
}

export type ClientToServer =
  | { type: "ping" }
  | { type: "subscribe"; rooms: string[] }
  | { type: "device.heartbeat"; deviceId: string; name: string; appVersion: string };
