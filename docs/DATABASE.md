# Database Setup & Care

## Local café database (SQLite)

File: `apps/server/data/brewbean.db` (created on first boot, WAL mode).

Enables: single-file backup, crash-safe transactions, zero administration.

### Backup (run nightly via cron/Task Scheduler)

```bash
sqlite3 apps/server/data/brewbean.db ".backup 'backups/brewbean-$(date +%F).db'"
```

Or simply copy the `data/` directory while the server is stopped.
Keep 30 days of backups; sync the `backups/` folder offsite (rclone, S3, etc.).

### Restore

```bash
# stop server → replace file → start server
cp backups/brewbean-2026-09-23.db apps/server/data/brewbean.db
```

### Inspecting

```bash
sqlite3 apps/server/data/brewbean.db
.tables
SELECT order_no, status, total_cents FROM orders ORDER BY created_at DESC LIMIT 20;
```

## Cloud database (PostgreSQL)

Provision Postgres 14+ (RDS, Neon, Supabase, or a VPS). Apply schema:

```bash
cd apps/cloud && npm run migrate
```

### Backup

```bash
pg_dump "$DATABASE_URL" | gzip > backups/cloud-$(date +%F).sql.gz
```

## Schema overview

Core relational schema (local SQLite, identical shape mirrored in cloud):

| Group | Tables |
|---|---|
| Identity & access | `users`, `refresh_tokens` |
| Catalog | `categories`, `products`, `modifier_groups`, `modifier_options` |
| Inventory | `ingredients`, `recipes`, `inventory_tx` |
| Trading | `orders`, `order_items`, `payments`, `refunds`, `customers`, `discounts` |
| Operations | `tables`, `shifts`, `devices`, `printers`, `print_jobs` |
| Platform | `settings`, `audit_log`, `notifications`, `counters`, `sync_outbox`, `sync_state` |

Key constraints:

- `orders.order_no` UNIQUE — allocated atomically via `counters`
- `payments.idempotency_key` UNIQUE — duplicate-pay protection
- `order_items` FK CASCADE to `orders`
- `orders.status` CHECK-constrained lifecycle: open → paid/completed →
  cancelled/refunded/partially_refunded
- All money stored as integer **cents**
- Indexes on `orders(created_at, status, cashier_id)`, `order_items(product_id)`,
  `inventory_tx(ingredient_id, created_at)`
