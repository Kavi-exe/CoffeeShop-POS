import Database from "better-sqlite3";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { config } from "./config.js";

export type DB = Database.Database;

let db: DB | null = null;

export function getDb(): DB {
  if (!db) throw new Error("DB not initialised");
  return db;
}

export function initDb(): DB {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function newId(): string {
  return nanoid(21);
}

export function now(): string {
  return new Date().toISOString();
}

/** Migrations run inside a transaction; version tracked in _migrations. */
export function migrate(d: DB): void {
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const current = (d.prepare("SELECT MAX(version) v FROM _migrations").get() as any).v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      const tx = d.transaction(() => {
        d.exec(m.sql);
        d.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(
          m.version,
          now()
        );
      });
      tx();
      console.log(`[db] applied migration ${m.version}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,              -- bcrypt-like via scrypt (node:crypto)
      role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      device_id TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      icon TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      printer_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      image_emoji TEXT NOT NULL DEFAULT '🍽️',
      image_url TEXT,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      cost_cents INTEGER,
      taxable INTEGER NOT NULL DEFAULT 1,
      available TEXT NOT NULL DEFAULT 'available' CHECK (available IN ('available','low','out')),
      allow_modifiers INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_products_cat ON products(category_id);

    CREATE TABLE modifier_groups (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      min_select INTEGER NOT NULL DEFAULT 0,
      max_select INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_mg_product ON modifier_groups(product_id);

    CREATE TABLE modifier_options (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price_delta_cents INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_mo_group ON modifier_options(group_id);

    CREATE TABLE ingredients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock_qty REAL NOT NULL DEFAULT 0,
      min_stock_qty REAL NOT NULL DEFAULT 0,
      purchase_price_cents INTEGER NOT NULL DEFAULT 0,
      supplier TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE recipes (
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
      qty_per_unit REAL NOT NULL CHECK (qty_per_unit > 0),
      PRIMARY KEY (product_id, ingredient_id)
    );

    CREATE TABLE inventory_tx (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
      type TEXT NOT NULL CHECK (type IN ('sale','purchase','adjustment','waste','damage','stock_count','return')),
      delta_qty REAL NOT NULL,
      balance_after REAL NOT NULL,
      order_id TEXT,
      user_id TEXT,
      user_name TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_invtx_ing ON inventory_tx(ingredient_id);
    CREATE INDEX idx_invtx_time ON inventory_tx(created_at);

    CREATE TABLE tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seats INTEGER NOT NULL DEFAULT 4,
      zone TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      order_no INTEGER NOT NULL UNIQUE,
      device_order_id TEXT UNIQUE,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','delivery')),
      status TEXT NOT NULL CHECK (status IN ('open','held','paid','completed','cancelled','refunded','partially_refunded')),
      table_id TEXT,
      table_name TEXT,
      delivery_json TEXT,
      customer_note TEXT,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      order_discount_cents INTEGER NOT NULL DEFAULT 0,
      taxable_base_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL,
      service_cents INTEGER NOT NULL,
      delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      cost_cents INTEGER,                      -- ingredient cost at sale time (profit)
      offline_created INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancel_reason TEXT,
      synced_at TEXT
    );
    CREATE INDEX idx_orders_time ON orders(created_at);
    CREATE INDEX idx_orders_status ON orders(status);
    CREATE INDEX idx_orders_cashier ON orders(cashier_id);
    CREATE INDEX idx_orders_device ON orders(device_id);

    CREATE TABLE order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      qty REAL NOT NULL CHECK (qty > 0),
      unit_price_cents INTEGER NOT NULL,
      modifiers_json TEXT NOT NULL DEFAULT '[]',
      modifiers_total_cents INTEGER NOT NULL DEFAULT 0,
      unit_price_with_mods_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      line_total_cents NOT NULL,
      note TEXT,
      station TEXT NOT NULL DEFAULT 'bar' CHECK (station IN ('bar','kitchen')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printed','made','served'))
    );
    CREATE INDEX idx_items_order ON order_items(order_id);
    CREATE INDEX idx_items_product ON order_items(product_id);

    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      method TEXT NOT NULL CHECK (method IN ('cash','cash_in','cash_out','card','bank_transfer','qr','online','split')),
      status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('pending','authorized','captured','failed','refunded','partially_refunded')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      cash_received_cents INTEGER,
      change_cents INTEGER,
      reference TEXT,
      split_json TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      created_by TEXT
    );
    CREATE INDEX idx_pay_order ON payments(order_id);
    CREATE INDEX idx_pay_method ON payments(method);

    CREATE TABLE refunds (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      payment_id TEXT,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL,
      method TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      restock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_refunds_order ON refunds(order_id);

    CREATE TABLE shifts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      opening_cash_cents INTEGER NOT NULL,
      counted_cash_cents INTEGER,
      expected_cash_cents INTEGER,
      difference_cents INTEGER,
      notes TEXT,
      status TEXT NOT NULL CHECK (status IN ('open','closed')),
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX idx_shifts_user ON shifts(user_id);

    CREATE TABLE printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('receipt','kitchen')),
      connection TEXT NOT NULL CHECK (connection IN ('network','usb','bluetooth','file')),
      address TEXT,
      usb_device TEXT,
      file_sink_dir TEXT,
      codepage TEXT NOT NULL DEFAULT 'cp437',
      width_dots INTEGER NOT NULL DEFAULT 576,
      categories_json TEXT NOT NULL DEFAULT '[]',
      print_modifiers INTEGER NOT NULL DEFAULT 1,
      print_logo INTEGER NOT NULL DEFAULT 0,
      copies INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online','offline','error','unknown')),
      last_seen_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE print_jobs (
      id TEXT PRIMARY KEY,
      printer_id TEXT NOT NULL REFERENCES printers(id),
      order_id TEXT,
      order_no INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('receipt','kitchen')),
      payload TEXT NOT NULL,             -- ESC/POS bytes base64 or text template
      payload_kind TEXT NOT NULL DEFAULT 'escpos',
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','printed','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      printed_at TEXT
    );
    CREATE INDEX idx_jobs_printer ON print_jobs(printer_id, status);

    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'pos' CHECK (kind IN ('pos','server','admin')),
      app_version TEXT,
      last_seen_at TEXT NOT NULL,
      online INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_customers_phone ON customers(phone);

    CREATE TABLE discounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('percent','amount')),
      value INTEGER NOT NULL,             -- percent (0-100) or cents
      requires_manager INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      role TEXT,
      device_id TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail TEXT NOT NULL,
      meta_json TEXT,
      source TEXT NOT NULL DEFAULT 'local'
    );
    CREATE INDEX idx_audit_time ON audit_log(at);
    CREATE INDEX idx_audit_action ON audit_log(action);

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id TEXT NOT NULL UNIQUE,
      entity TEXT NOT NULL,
      op TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      at TEXT NOT NULL,
      pushed_at TEXT
    );
    CREATE INDEX idx_outbox_pending ON sync_outbox(pushed_at);

    CREATE TABLE sync_state (
      device_id TEXT PRIMARY KEY,
      last_pulled_seq INTEGER NOT NULL DEFAULT 0,
      last_pushed_seq INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_sync_at TEXT
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    `,
  },
];
