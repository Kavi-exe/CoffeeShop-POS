# Offline Mode & Synchronization

## Layers of offline protection

### Layer 1 — POS tablet (IndexedDB)
The POS keeps a full catalog snapshot and order queue in IndexedDB (Dexie).
If the **local server is unreachable**, the POS:
- keeps taking orders (prices & modifiers from the snapshot)
- records the sale intent + payment locally
- prints a fallback receipt from the browser
- queues the order with a client-generated UUID (`deviceOrderId`)

When the server reappears, queued orders replay **oldest-first** and the server
deduplicates on `device_order_id` (UNIQUE) — retries can never double-create.

### Layer 2 — Local server (SQLite outbox)
Every mutation (orders, payments, refunds, inventory, audit, shifts…) is also
written to `sync_outbox` inside the same transaction. A sync engine pushes
batches to the cloud every 5s when online:

- cursor-tracked (`sync_state.last_pushed_seq`) — no gaps, no duplicates
- crash-safe: unacked batches are simply re-sent (idempotent ingest)
- exponential visibility on failure; buffer is unbounded (disk-bound)

### Layer 3 — Cloud ingest (idempotent, append-only)
The cloud applies each envelope **once** (unique envelope id). Financial
entities are insert-only with upsert-by-PK semantics; catalog entities use
last-writer-wins keyed on the mutation timestamp. Order numbers stay unique
because the café local server is the single allocator.

## Conflict handling

| Entity | Policy | Why |
|---|---|---|
| orders/payments/refunds | insert-only, keyed by id | financial truth is created at the café |
| products/settings | LWW on `updatedAt` | remote edits made while café was offline |
| inventory | balance snapshots (`balanceAfter`) | last physical count wins; history kept |

The **café keeps trading** under every failure combination in the matrix below.

## Failure matrix

| Scenario | Behaviour |
|---|---|
| Internet down, server up | 100% normal operation; cloud catches up on reconnect |
| Server down (crash/power) | POS queues orders locally; receipts print via browser fallback |
| Internet restored | Outbox drains (batched); dashboard totals jump forward |
| Tablet Wi-Fi blip | Order replays in seconds; duplicate ids rejected silently |
| Printer offline | Jobs queue durably, print on recovery; status shown on dashboard |

## Monitoring sync

- POS top bar: `● Online` / `○ Offline · N queued`
- Admin dashboard: sync status card (pending count, last sync time)
- `GET /v1/sync/status` on the local server
