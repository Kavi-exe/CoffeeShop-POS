import { hashPassword } from "./auth.js";
import { getDb, newId, now } from "../db.js";

/** Idempotent seed: only inserts when tables are empty. */
export function seedIfEmpty(): void {
  const db = getDb();
  const userCount = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c;
  if (userCount > 0) return;

  console.log("[seed] seeding initial data…");
  const at = now();
  const id = () => newId();
  const ids: Record<string, string> = {};

  // ---------- users ----------
  const insUser = db.prepare(
    `INSERT INTO users (id, username, display_name, pin_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`
  );
  const users: Array<[string, string, string, string]> = [
    ["owner", "Owner", "owner123", "owner"],
    ["manager", "Manager", "manager123", "manager"],
    ["cashier1", "Cashier One", "cashier123", "cashier"],
    ["cashier2", "Cashier Two", "cashier123", "cashier"],
  ];
  for (const [username, display, password, role] of users) {
    const uid = id();
    ids[username] = uid;
    insUser.run(uid, username, display, hashPassword(password), role, at, at);
  }

  // ---------- tables ----------
  const insTable = db.prepare(`INSERT INTO tables (id, name, seats, zone, sort_order) VALUES (?,?,?,?,?)`);
  for (let i = 1; i <= 8; i++) {
    insTable.run(id(), `Table ${String(i).padStart(2, "0")}`, i <= 4 ? 4 : 2, i <= 4 ? "Indoor" : "Garden", i);
  }

  // ---------- categories ----------
  const cats: Array<[string, string, string, string]> = [
    ["coffee", "Coffee", "#8B5A2B", "☕"],
    ["tea", "Tea", "#2E7D32", "🍵"],
    ["juice", "Juice", "#F57F17", "🧃"],
    ["smoothies", "Smoothies", "#AD1457", "🥤"],
    ["soft-drinks", "Soft Drinks", "#0277BD", "🥫"],
    ["desserts", "Desserts", "#6A1B9A", "🍰"],
    ["snacks", "Snacks", "#EF6C00", "🍟"],
    ["bakery", "Bakery", "#5D4037", "🥐"],
    ["specials", "Specials", "#B71C1C", "⭐"],
  ];
  const insCat = db.prepare(
    `INSERT INTO categories (id, name, color, icon, sort_order, updated_at) VALUES (?,?,?,?,?,?)`
  );
  cats.forEach(([cid, name, color, icon], i) => {
    ids[`cat_${cid}`] = cid;
    insCat.run(cid, name, color, icon, i + 1, at);
  });

  // ---------- ingredients ----------
  const ing: Array<[string, string, string, number, number, number, string]> = [
    ["coffee-beans", "Coffee Beans", "g", 5000, 500, 12, "Lanka Beans Co."],
    ["milk", "Milk", "ml", 40000, 5000, 3, "Ceylon Dairy"],
    ["low-fat-milk", "Low Fat Milk", "ml", 15000, 3000, 3, "Ceylon Dairy"],
    ["oat-milk", "Oat Milk", "ml", 6000, 1500, 9, "Green Farms"],
    ["sugar", "Sugar", "g", 10000, 1000, 1, "Ceylon Sugar"],
    ["syrup", "Syrup", "ml", 3000, 500, 6, "Syrups Ltd"],
    ["tea-leaves", "Tea Leaves", "g", 2000, 300, 8, "Hill Tea Estate"],
    ["oranges", "Oranges", "pcs", 60, 10, 40, "Fruit Market"],
    ["mango", "Mango", "pcs", 25, 5, 90, "Fruit Market"],
    ["banana", "Banana", "pcs", 40, 8, 15, "Fruit Market"],
    ["ice", "Ice", "g", 30000, 5000, 0, "In-house"],
    ["yogurt", "Yogurt", "ml", 8000, 1500, 4, "Ceylon Dairy"],
    ["cola-cans", "Cola Can", "pcs", 48, 12, 120, "Beverage Dist."],
    ["lemonade-bottles", "Lemonade Bottle", "pcs", 24, 6, 180, "Beverage Dist."],
    ["buns", "Burger Buns", "pcs", 30, 6, 25, "Daily Bakery"],
    ["chicken-patty", "Chicken Patty", "pcs", 20, 5, 140, "Fresh Foods"],
    ["cheese-slices", "Cheese Slice", "pcs", 40, 10, 18, "Fresh Foods"],
    ["croissant", "Croissant", "pcs", 18, 4, 95, "Daily Bakery"],
    ["chocolate-cake", "Chocolate Cake Slice", "pcs", 12, 3, 160, "Daily Bakery"],
    ["fries", "Frozen Fries", "g", 4000, 800, 3, "Fresh Foods"],
  ];
  const insIng = db.prepare(
    `INSERT INTO ingredients (id, name, unit, stock_qty, min_stock_qty, purchase_price_cents, supplier, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const [iid, name, unit, qty, min, price, supplier] of ing) {
    ids[`ing_${iid}`] = iid;
    insIng.run(iid, name, unit, qty, min, price, supplier, at);
  }

  // ---------- products ----------
  const insProduct = db.prepare(
    `INSERT INTO products (id, category_id, sku, name, description, image_emoji, price_cents, cost_cents, taxable, allow_modifiers, sort_order, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const products: Array<{
    pid: string; cat: string; sku: string; name: string; emoji: string; price: number;
    mods?: boolean; desc?: string;
  }> = [
    { pid: "espresso", cat: "coffee", sku: "CF-ESP", name: "Espresso", emoji: "☕", price: 45000, mods: true },
    { pid: "americano", cat: "coffee", sku: "CF-AME", name: "Americano", emoji: "☕", price: 55000, mods: true },
    { pid: "latte", cat: "coffee", sku: "CF-LAT", name: "Café Latte", emoji: "☕", price: 80000, mods: true },
    { pid: "cappuccino", cat: "coffee", sku: "CF-CAP", name: "Cappuccino", emoji: "☕", price: 80000, mods: true },
    { pid: "mocha", cat: "coffee", sku: "CF-MOC", name: "Mocha", emoji: "☕", price: 90000, mods: true },
    { pid: "flat-white", cat: "coffee", sku: "CF-FWH", name: "Flat White", emoji: "☕", price: 85000, mods: true },
    { pid: "plain-tea", cat: "tea", sku: "TE-PLN", name: "Plain Tea", emoji: "🍵", price: 30000, mods: true },
    { pid: "milk-tea", cat: "tea", sku: "TE-MLK", name: "Milk Tea", emoji: "🍵", price: 45000, mods: true },
    { pid: "green-tea", cat: "tea", sku: "TE-GRN", name: "Green Tea", emoji: "🍵", price: 50000, mods: true },
    { pid: "orange-juice", cat: "juice", sku: "JU-ORG", name: "Orange Juice", emoji: "🧃", price: 70000, mods: true, desc: "Freshly squeezed" },
    { pid: "mango-juice", cat: "juice", sku: "JU-MAN", name: "Mango Juice", emoji: "🧃", price: 75000, mods: true },
    { pid: "mango-smoothie", cat: "smoothies", sku: "SM-MAN", name: "Mango Smoothie", emoji: "🥤", price: 95000, mods: true },
    { pid: "banana-smoothie", cat: "smoothies", sku: "SM-BAN", name: "Banana Smoothie", emoji: "🥤", price: 85000, mods: true },
    { pid: "cola", cat: "soft-drinks", sku: "SD-COL", name: "Cola Can", emoji: "🥫", price: 35000 },
    { pid: "lemonade", cat: "soft-drinks", sku: "SD-LEM", name: "Lemonade", emoji: "🥫", price: 40000 },
    { pid: "choc-cake", cat: "desserts", sku: "DS-CHC", name: "Chocolate Cake", emoji: "🍰", price: 65000 },
    { pid: "cheesecake", cat: "desserts", sku: "DS-CHS", name: "Cheesecake", emoji: "🍰", price: 75000 },
    { pid: "fries", cat: "snacks", sku: "SN-FRY", name: "French Fries", emoji: "🍟", price: 55000 },
    { pid: "chicken-burger", cat: "snacks", sku: "SN-BRG", name: "Chicken Burger", emoji: "🍔", price: 110000 },
    { pid: "croissant", cat: "bakery", sku: "BK-CRO", name: "Butter Croissant", emoji: "🥐", price: 48000 },
    { pid: "choc-croissant", cat: "bakery", sku: "BK-CCRO", name: "Chocolate Croissant", emoji: "🥐", price: 55000 },
    { pid: "special-devi", cat: "specials", sku: "SP-DEV", name: "Devi's Blend", emoji: "⭐", price: 95000, mods: true, desc: "Signature espresso with jaggery syrup" },
  ];
  products.forEach((p, i) => {
    ids[`prod_${p.pid}`] = p.pid;
    insProduct.run(
      p.pid, ids[`cat_${p.cat}`], p.sku, p.name, p.desc ?? null, p.emoji, p.price, null,
      p.cat === "soft-drinks" ? 0 : 1, p.mods ? 1 : 0, i + 1, at
    );
  });

  // ---------- modifier groups & options ----------
  const insGroup = db.prepare(
    `INSERT INTO modifier_groups (id, product_id, name, min_select, max_select, sort_order) VALUES (?,?,?,?,?,?)`
  );
  const insOpt = db.prepare(
    `INSERT INTO modifier_options (id, group_id, name, price_delta_cents, is_default, sort_order) VALUES (?,?,?,?,?,?)`
  );

  const sizeGroup = (productId: string) => {
    const g = id();
    insGroup.run(g, productId, "Size", 1, 1, 1);
    insOpt.run(id(), g, "Small", 0, 1, 1);
    insOpt.run(id(), g, "Medium", 5000, 0, 2);
    insOpt.run(id(), g, "Large", 10000, 0, 3);
  };
  const milkGroup = (productId: string) => {
    const g = id();
    insGroup.run(g, productId, "Milk", 1, 1, 2);
    insOpt.run(id(), g, "Normal", 0, 1, 1);
    insOpt.run(id(), g, "Low Fat", 0, 0, 2);
    insOpt.run(id(), g, "Oat Milk", 15000, 0, 3);
  };
  const sugarGroup = (productId: string) => {
    const g = id();
    insGroup.run(g, productId, "Sugar", 1, 1, 3);
    insOpt.run(id(), g, "No Sugar", 0, 0, 1);
    insOpt.run(id(), g, "Normal", 0, 1, 2);
    insOpt.run(id(), g, "Extra", 0, 0, 3);
  };
  const addonsGroup = (productId: string) => {
    const g = id();
    insGroup.run(g, productId, "Add-ons", 0, 4, 4);
    insOpt.run(id(), g, "Extra Shot", 10000, 0, 1);
    insOpt.run(id(), g, "Whipped Cream", 8000, 0, 2);
    insOpt.run(id(), g, "Vanilla Syrup", 6000, 0, 3);
    insOpt.run(id(), g, "Extra Ice", 0, 0, 4);
  };

  const coffeeDrink = (pid: string) => {
    sizeGroup(pid); milkGroup(pid); sugarGroup(pid); addonsGroup(pid);
  };
  for (const pid of ["espresso", "americano", "latte", "cappuccino", "mocha", "flat-white", "special-devi"]) {
    coffeeDrink(pid);
  }
  for (const pid of ["plain-tea", "milk-tea", "green-tea"]) {
    sizeGroup(pid); sugarGroup(pid);
  }
  for (const pid of ["orange-juice", "mango-juice"]) {
    sizeGroup(pid); addonsGroup(pid);
  }
  for (const pid of ["mango-smoothie", "banana-smoothie"]) {
    sizeGroup(pid); addonsGroup(pid);
  }

  // ---------- recipes ----------
  const insRecipe = db.prepare(
    `INSERT OR REPLACE INTO recipes (product_id, ingredient_id, qty_per_unit) VALUES (?,?,?)`
  );
  const recipes: Array<[string, string, number]> = [
    ["espresso", "coffee-beans", 18],
    ["espresso", "sugar", 5],
    ["americano", "coffee-beans", 18],
    ["americano", "sugar", 5],
    ["latte", "coffee-beans", 18],
    ["latte", "milk", 200],
    ["latte", "sugar", 10],
    ["cappuccino", "coffee-beans", 18],
    ["cappuccino", "milk", 180],
    ["cappuccino", "sugar", 10],
    ["mocha", "coffee-beans", 18],
    ["mocha", "milk", 200],
    ["mocha", "sugar", 15],
    ["flat-white", "coffee-beans", 18],
    ["flat-white", "milk", 160],
    ["plain-tea", "tea-leaves", 4],
    ["milk-tea", "tea-leaves", 4],
    ["milk-tea", "milk", 150],
    ["milk-tea", "sugar", 10],
    ["green-tea", "tea-leaves", 4],
    ["orange-juice", "oranges", 3],
    ["mango-juice", "mango", 1],
    ["mango-juice", "sugar", 8],
    ["mango-smoothie", "mango", 1],
    ["mango-smoothie", "yogurt", 150],
    ["mango-smoothie", "milk", 100],
    ["banana-smoothie", "banana", 1],
    ["banana-smoothie", "yogurt", 150],
    ["banana-smoothie", "milk", 100],
    ["cola", "cola-cans", 1],
    ["lemonade", "lemonade-bottles", 1],
    ["choc-cake", "chocolate-cake", 1],
    ["cheesecake", "chocolate-cake", 1],
    ["fries", "fries", 200],
    ["chicken-burger", "buns", 1],
    ["chicken-burger", "chicken-patty", 1],
    ["chicken-burger", "cheese-slices", 1],
    ["croissant", "croissant", 1],
    ["choc-croissant", "croissant", 1],
    ["special-devi", "coffee-beans", 18],
    ["special-devi", "milk", 200],
    ["special-devi", "syrup", 15],
  ];
  for (const [pid, iid, qty] of recipes) insRecipe.run(pid, iid, qty);

  // ---------- printers ----------
  const insPrinter = db.prepare(
    `INSERT INTO printers (id, name, kind, connection, address, file_sink_dir, categories_json, print_modifiers, copies, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  insPrinter.run(
    "printer-01", "Kitchen Printer", "kitchen", "file", null, "./data/print-jobs",
    JSON.stringify(["desserts", "snacks", "bakery", "specials"]), 1, 1, at
  );
  insPrinter.run(
    "printer-02", "Bar Printer", "receipt", "file", null, "./data/print-jobs",
    JSON.stringify(["coffee", "tea", "juice", "smoothies", "soft-drinks"]), 1, 1, at
  );

  // ---------- settings ----------
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('cafe', ?, ?)`
  ).run(
    JSON.stringify({
      name: "BrewBean Café",
      legalName: "BrewBean (Pvt) Ltd",
      address: "42 Palm Avenue, Colombo 03",
      phone: "+94 11 234 5678",
      currency: "LKR",
      currencySymbol: "Rs",
      taxPercent: 0,
      serviceChargePercent: 10,
      receiptFooter: "Thank you for visiting BrewBean Café! ☕",
    }),
    at
  );

  // ---------- devices ----------
  const insDevice = db.prepare(`INSERT INTO devices (id, name, kind, last_seen_at, online, registered_at) VALUES (?,?,?,?,0,?)`);
  insDevice.run("pos-01", "POS 01", "pos", at, at);
  insDevice.run("pos-02", "POS 02", "pos", at, at);
  insDevice.run("cafe-local-01", "Local Server", "server", at, at);

  console.log("[seed] done: 4 users, 9 categories, 22 products, 20 ingredients, 8 tables, 2 printers");
}
