# BrewBean Café POS — Hybrid Offline + Online Point of Sale

A production-grade, offline-first POS platform for a modern café: two simultaneous POS
tablets, a central **local server** (the source of truth while open), two receipt/kitchen
printers behind a routing layer, and a **cloud API + admin dashboard** for remote,
near-real-time monitoring from the owner's phone.

```
CUSTOMER
   ↓
POS TABLET 01 / POS TABLET 02      (React + TS, offline-first IndexedDB)
   ↓  REST + WebSocket (LAN)
LOCAL POS SERVER                   (Node + Fastify, SQLite via better-sqlite3)
   ├── LOCAL DATABASE              (SQLite, WAL — survives crashes & power loss)
   ├── PRINTER ROUTING             (ESC/POS over network / USB-via-CUPS / file sink)
   │      ├── PRINTER 01 — Kitchen (food, bakery, desserts)
   │      └── PRINTER 02 — Bar     (coffee, tea, juice, smoothies, soft drinks)
   └── SYNC AGENT ── outbox → CLOUD API (Node + Fastify, PostgreSQL)
                          ↓
                  CLOUD DATABASE (Postgres) ── SSE ── OWNER MOBILE DASHBOARD (React + TS)
```

## Packages

| Path | What it is |
|---|---|
| `packages/shared` | TypeScript contracts shared by all apps: DB row types, DTOs, API + WebSocket event schemas, money utils, sync protocol, audit helpers |
| `apps/server` | **Local POS server.** SQLite (WAL), JWT auth with refresh tokens, RBAC, orders/payments/refunds with real SQL transactions, recipe-based inventory engine, printer routing + ESC/POS rendering, shift management, reports, audit log, sync outbox/pull engine, WebSocket hub, print worker with retries |
| `apps/cloud` | **Cloud API.** Postgres schema, append-only ingest (per-device cursors, idempotency keys, LWW conflict resolution), dashboard/reporting APIs, SSE stream, notifications, JWT auth |
| `apps/pos` | **POS tablet app.** Vite + React. Works fully offline (Dexie/IndexedDB), optimistic cart, modifiers, discounts, holds, tables, split payments, cash change, receipt preview, shift open/close, printer/online status |
| `apps/admin` | **Owner/manager dashboard.** Mobile-first, bottom nav, dark/light mode, live totals via SSE, charts, orders, inventory, products, printers, users, reports, settings |

## Quick start (dev, all-in-one with Docker)

```bash
docker compose up --build
# POS:        http://localhost:5173   (login: cashier1 / cashier123)
# Admin:      http://localhost:5174   (login: owner / owner123)
# Local API:  http://localhost:8080   (JWT auth)
# Cloud API:  http://localhost:8090   (JWT auth)
```

## Quick start (dev, without Docker)

```bash
# 1) shared contracts
cd packages/shared && npm install && npm run build

# 2) local server — creates and seeds data/brewbean.db on first boot
cd ../../apps/server && npm install && npm run dev

# 3) cloud API (needs Postgres; see .env.example)
cd ../../apps/cloud && npm install && npm run dev

# 4) POS tablet (two browser windows = two devices)
cd ../../apps/pos && npm install && npm run dev

# 5) admin dashboard
cd ../../apps/admin && npm install && npm run dev
```

Full documentation lives in [`docs/`](docs) — installation, database setup, printer setup,
offline synchronization design, cloud deployment, backup/restore, and production runbook.

## Default logins (seeded, change immediately)

| Role | Username | Password | Scope |
|---|---|---|---|
| Owner / Super Admin | `owner` | `owner123` | everything |
| Manager | `manager` | `manager123` | sales, inventory, reports, products, employees |
| Cashier | `cashier1` | `cashier123` | POS, orders, payments, receipts |
| Cashier | `cashier2` | `cashier123` | POS, orders, payments, receipts |

## Design principles

- **Reliability over decoration.** Every order write is a real SQL transaction; payments are
  idempotent; order numbers come from an atomic counter table (no duplicates, ever).
- **Offline is the default, not the fallback.** The POS queue writes locally and replicates;
  the local server is authoritative; the cloud is an eventually-consistent mirror.
- **Printers are abstracted.** Categories → printer routes, ESC/POS rendered server-side,
  durable queue with exponential-backoff retries and offline status tracking.
- **Financial records are append-only.** `orders` / `payments` are never deleted — status
  transitions (`completed → cancelled/refunded`) are recorded with an audit trail.
- **Every sensitive action is audited.** “Cashier John applied 20% discount to Order #1045”.
