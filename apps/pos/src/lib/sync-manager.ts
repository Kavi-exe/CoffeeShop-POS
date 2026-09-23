import { db } from "./local-db.js";
import { api } from "./api.js";

type Listener = (online: boolean, pending: number) => void;

const listeners = new Set<Listener>();
let online = navigator.onLine;
let syncing = false;
let timer: number | null = null;

export function onSyncStateChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  void db.pendingOrders.where("state").anyOf("pending", "failed").count().then((pending) => {
    for (const fn of listeners) fn(online, pending);
  });
}

export function isOnline(): boolean {
  return online;
}

export async function refreshOnlineState(): Promise<boolean> {
  try {
    const res = await fetch(`/health`, { method: "GET", cache: "no-store" });
    online = res.ok;
  } catch {
    online = false;
  }
  emit();
  return online;
}

/**
 * Full sync pass:
 *  1. replay pending orders (oldest first, idempotent by deviceOrderId)
 *  2. refresh catalog snapshot (categories + products)
 * Safe to call repeatedly; never throws.
 */
export async function syncNow(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const reachable = await refreshOnlineState();
    if (!reachable) return;

    // 1) replay pending orders
    const pending = await db.pendingOrders.where("state").anyOf("pending", "failed").sortBy("createdAt");
    for (const p of pending) {
      try {
        const order = await api("/orders", { method: "POST", body: p.payload });
        await db.pendingOrders.update(p.id, { state: "acked", ackedOrder: order, lastError: undefined });
        if (p.state === "pending") {
          await db.meta.put({ key: `acked:${p.id}`, value: JSON.stringify(order) });
        }
      } catch (err: any) {
        const status = err?.status ?? 0;
        if (status === 0) {
          online = false;
          emit();
          return; // went offline mid-sync; stop
        }
        // 4xx = permanent rejection (validation/duplicate) — mark failed, keep for inspection
        await db.pendingOrders.update(p.id, { state: "failed", lastError: String(err?.message ?? err), attempts: p.attempts + 1 });
      }
    }

    // 2) refresh catalog
    const [categories, products] = await Promise.all([
      api<any[]>("/categories"),
      api<any[]>("/products"),
    ]);
    await db.transaction("rw", db.categories, db.products, async () => {
      await db.categories.clear();
      await db.categories.bulkPut(categories);
      await db.products.clear();
      await db.products.bulkPut(products);
    });

    await db.meta.put({ key: "lastSyncAt", value: new Date().toISOString() });
    online = true;
  } catch {
    online = false;
  } finally {
    syncing = false;
    emit();
  }
}

export function startSyncLoop(intervalMs = 15000): void {
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => {
    online = false;
    emit();
  });
  void syncNow();
  timer = window.setInterval(() => void syncNow(), intervalMs);
}

export function stopSyncLoop(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

/** Queue an order locally; replayed automatically. Returns local id. */
export async function queueOrder(payload: unknown, localId: string): Promise<void> {
  await db.pendingOrders.put({
    id: localId,
    createdAt: new Date().toISOString(),
    payload,
    state: "pending",
    attempts: 0,
  });
  emit();
  if (online) void syncNow();
}

/** The server's canonical order for a queued one, if acked. */
export async function getAckedOrder<T = unknown>(localId: string): Promise<T | null> {
  const row = await db.pendingOrders.get(localId);
  if (row?.state === "acked" && row.ackedOrder) return row.ackedOrder as T;
  const meta = await db.meta.get(`acked:${localId}`);
  return meta ? (JSON.parse(meta.value) as T) : null;
}
