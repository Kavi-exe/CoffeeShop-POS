/**
 * Sync protocol between the local server and the cloud.
 *
 * Model: append-only, per-entity-type sequence numbers (monotonic per device),
 * idempotency keys, and last-writer-wins conflict resolution keyed by
 * `updatedAt` with a deterministic tiebreak (deviceId) — while financial
 * records (orders/payments/refunds) are insert-only and can never conflict.
 */

export type SyncEntity =
  | "orders"
  | "payments"
  | "refunds"
  | "products"
  | "categories"
  | "modifier_groups"
  | "modifier_options"
  | "recipes"
  | "ingredients"
  | "inventory_transactions"
  | "users"
  | "shifts"
  | "devices"
  | "tables"
  | "printers"
  | "settings"
  | "audit_logs"
  | "customers"
  | "discounts"
  | "notifications";

export interface SyncEnvelope<T = unknown> {
  id: string; // unique per mutation (uuid) — idempotency key
  entity: SyncEntity;
  op: "insert" | "update" | "delete";
  localSeq: number; // monotonic per device
  at: string; // mutation timestamp (ISO)
  deviceId: string;
  payload: T;
  schemaVersion: number;
}

export interface SyncPushRequest {
  deviceId: string;
  sinceSeq: number; // cursor the cloud already has from this device
  batch: SyncEnvelope[];
  finalSeq: number;
}

export interface SyncPushResponse {
  accepted: number;
  rejected: Array<{ id: string; reason: string }>;
  ackSeq: number; // highest contiguous seq stored
}

export interface SyncPullRequest {
  sinceSeq: number; // cloud-side global cursor for this device
  entities?: SyncEntity[];
  limit: number;
}

export interface SyncPullResponse {
  batch: SyncEnvelope[];
  nextSeq: number;
  hasMore: boolean;
}

export interface SyncState {
  deviceId: string;
  lastPushedSeq: number; // acked by cloud
  lastPulledSeq: number; // applied from cloud
  pendingCount: number;
  lastError?: string;
  lastSyncAt?: string;
}

export function isFinancialEntity(entity: SyncEntity): boolean {
  return entity === "orders" || entity === "payments" || entity === "refunds";
}
