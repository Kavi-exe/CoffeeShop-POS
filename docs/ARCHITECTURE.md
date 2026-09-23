# System Architecture

```
                    CUSTOMERS
                        ↓
        ┌───────────────────────────────┐
        │   POS TABLET 01   POS TABLET 02
        │   (React + TS)    (React + TS)
        │   offline-first (IndexedDB/Dexie)
        └──────────────┬────────────────┘
                       │ REST + WebSocket (LAN)
        ┌──────────────▼────────────────┐
        │        LOCAL POS SERVER       │   Node + Fastify
        │  ┌─────────────────────────┐  │
        │  │  SQLite (WAL)           │  │   source of truth while open
        │  │  orders/payments/inventory
        │  └─────────────────────────┘  │
        │  ┌─────────────────────────┐  │
        │  │  PRINT ROUTING          │  │   category → printer map
        │  │  ESC/POS · queue · retry│  │
        │  └──────────┬──────────────┘  │
        └─────────────┼─────────────────┘
              ┌───────┴────────┐
              ▼                ▼
        PRINTER 01        PRINTER 02
        Kitchen (food,    Bar (coffee, tea,
        bakery, desserts) juice, smoothies)
                       │
                       │ outbox → HTTPS (store-and-forward)
        ┌──────────────▼────────────────┐
        │          CLOUD API            │   Node + Fastify
        │  append-only ingest · SSE     │
        └──────────────┬────────────────┘
                       ▼
                POSTGRES (cloud mirror)
                       │
                       ▼ SSE
        ┌────────────────────────────────┐
        │  ADMIN DASHBOARD (React + TS)  │   owner's phone / desktop
        │  live KPIs · reports · alerts  │
        └────────────────────────────────┘
```

## Components

| Component | Tech | Role |
|---|---|---|
| **POS app** | React 18, TypeScript, Zustand, Dexie | Order taking. Fully functional with **zero network**: catalog snapshot, cart, totals, receipts, order queueing in IndexedDB. |
| **Local server** | Node 20, Fastify, better-sqlite3, JWT | Authoritative store during trading hours. All writes are SQL transactions. Runs the printer queue, sync outbox, RBAC, audit, shifts, reports. |
| **Cloud API** | Node 20, Fastify, PostgreSQL | Mirror of the café database. Append-only ingest with idempotency. Serves the dashboard and SSE stream. |
| **Admin dashboard** | React 18, TypeScript, Zustand | Mobile-first remote monitoring. Live updates over SSE. |

## Why this split

1. **The café keeps trading with the internet down.** POS ⇄ local server ⇄ printers
   is a closed LAN loop. Nothing on the critical order path touches the internet.
2. **Even the local server can vanish.** The POS queues orders in IndexedDB with
   idempotent ids (`deviceOrderId`) and replays them automatically — a tablet that
   briefly loses Wi-Fi never loses a sale.
3. **The cloud can never corrupt the café.** Sync is one-way for financial records
   (orders/payments/refunds are insert-only in the cloud), and LWW for catalog edits
   made remotely. Local SQLite remains authoritative.
4. **Two tablets, zero conflicts.** Order numbers are allocated by an atomic
   `UPDATE … RETURNING` on a counter row inside the same transaction as the order
   insert; payments are idempotent via `idempotency_key`; inventory deduction happens
   inside the order transaction.

## Order lifecycle

```
POS cart → POST /v1/orders            (server: tx{ order + items + recipe deduction })
        → kitchen/bar tickets queued  (split by item station)
POS pay  → POST /v1/orders/:id/pay    (server: tx{ payment + status transitions })
        → receipt queued (receipt printer)
        → WebSocket broadcast sale.completed
        → sync outbox → cloud (within ~5s when online)
```

## Offline matrix

| Failure | POS | Local server | Cloud dashboard |
|---|---|---|---|
| Internet down | ✅ normal | ✅ normal | stale until reconnect |
| Local server down | ✅ queues orders locally | — | stale |
| One tablet down | other ✅ | ✅ | stale |
| Cloud DB down | ✅ | ✅ (outbox buffers) | down |

## Key invariants

- An order number is **never** reused (atomic counter).
- A payment is **never** double-applied (`idempotency_key` unique).
- Inventory deduction is **never** skipped or double-counted (same tx as order).
- Financial rows are **never** deleted — status transitions only, all audited.
- Print jobs survive crashes (durable queue, retried with backoff).
