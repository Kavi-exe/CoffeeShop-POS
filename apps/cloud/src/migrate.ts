import { pool } from "./db.js";

const SCHEMA = `
-- Cloud mirror schema. Financial tables are append-only.
CREATE TABLE IF NOT EXISTS cloud_orders (
  id TEXT PRIMARY KEY,
  order_no INTEGER NOT NULL,
  device_order_id TEXT,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  table_name TEXT,
  delivery_json JSONB,
  cashier_id TEXT,
  cashier_name TEXT,
  subtotal_cents INTEGER NOT NULL,
  order_discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  service_cents INTEGER NOT NULL DEFAULT 0,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  cost_cents INTEGER,
  offline_created BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  items_json JSONB NOT NULL DEFAULT '[]',
  payments_json JSONB NOT NULL DEFAULT '[]',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corders_time ON cloud_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_corders_status ON cloud_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_corders_device_order ON cloud_orders(device_id, device_order_id);

CREATE TABLE IF NOT EXISTS cloud_refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES cloud_orders(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT,
  method TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_products (
  id TEXT PRIMARY KEY,
  category_id TEXT,
  sku TEXT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  cost_cents INTEGER,
  category_name TEXT,
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  available TEXT NOT NULL DEFAULT 'available',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  image_emoji TEXT,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock_qty REAL NOT NULL DEFAULT 0,
  min_stock_qty REAL NOT NULL DEFAULT 0,
  purchase_price_cents INTEGER DEFAULT 0,
  supplier TEXT,
  archived BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_inventory_tx (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT REFERENCES cloud_ingredients(id),
  type TEXT NOT NULL,
  delta_qty REAL NOT NULL,
  balance_after REAL NOT NULL,
  order_id TEXT,
  user_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_recipes (
  product_id TEXT NOT NULL REFERENCES cloud_products(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES cloud_ingredients(id),
  qty_per_unit REAL NOT NULL,
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS cloud_shifts (
  id TEXT PRIMARY KEY,
  user_id TEXT, user_name TEXT, device_id TEXT,
  opening_cash_cents INTEGER NOT NULL,
  counted_cash_cents INTEGER, expected_cash_cents INTEGER, difference_cents INTEGER,
  notes TEXT, status TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL, closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_devices (
  id TEXT PRIMARY KEY,
  name TEXT, kind TEXT,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ,
  online BOOLEAN DEFAULT FALSE,
  registered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_printers (
  id TEXT PRIMARY KEY,
  name TEXT, kind TEXT, connection TEXT, address TEXT,
  categories_json JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'unknown',
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_audit (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  user_id TEXT, user_name TEXT, role TEXT, device_id TEXT,
  action TEXT NOT NULL,
  entity TEXT, entity_id TEXT,
  detail TEXT NOT NULL,
  meta_json JSONB,
  source TEXT DEFAULT 'local'
);
CREATE INDEX IF NOT EXISTS idx_cloud_audit_time ON cloud_audit(at DESC);

CREATE TABLE IF NOT EXISTS cloud_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cloud_notifications (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cnot_time ON cloud_notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS cloud_discounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('percent','amount')),
  value INTEGER NOT NULL,
  requires_manager BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cloud_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT, address TEXT, note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ingest bookkeeping: per-device cursor
CREATE TABLE IF NOT EXISTS ingest_state (
  device_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- outbound fanout for other devices (e.g. second cafe branch, future local pulls)
CREATE TABLE IF NOT EXISTS cloud_outbound (
  global_seq BIGSERIAL PRIMARY KEY,
  envelope_id TEXT NOT NULL UNIQUE,
  entity TEXT NOT NULL,
  op TEXT NOT NULL,
  payload JSONB NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  from_device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_seq ON cloud_outbound(global_seq);

-- dashboard users (owner/manager accounts; separate from cafe staff PINs)
CREATE TABLE IF NOT EXISTS dashboard_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','manager','viewer')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dashboard_users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA);
  console.log("[cloud] schema migrated");
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
