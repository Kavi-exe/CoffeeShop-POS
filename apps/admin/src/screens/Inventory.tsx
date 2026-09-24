import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  stockQty: number;
  minStockQty: number;
  status: string;
};

type Modal =
  | { kind: "none" }
  | { kind: "add-ingredient" }
  | { kind: "adjust"; ing: Ingredient };

export default function InventoryScreen() {
  const [tab, setTab] = useState<"ingredients" | "products">("ingredients");
  const [items, setItems] = useState<Ingredient[]>([]);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState<Modal>({ kind: "none" });

  const role = JSON.parse(localStorage.getItem("bb.user") ?? "{}").role ?? "cashier";
  const canManage = role === "owner" || role === "manager";

  async function load() {
    try {
      setItems(await api("/dashboard/low-stock"));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    if (tab === "ingredients") void load();
  }, [tab]);

  const out = items.filter((i) => i.status === "out");
  const low = items.filter((i) => i.status === "low");
  const ok = items.filter((i) => i.status === "ok");

  return (
    <div>
      <div className="seg">
        <button className={tab === "ingredients" ? "active" : ""} onClick={() => setTab("ingredients")}>
          📦 Ingredients
        </button>
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>
          🧾 Products
        </button>
      </div>

      {tab === "ingredients" && (
        <IngredientsPanel items={items} out={out} low={low} ok={ok} err={err} canManage={canManage} onReload={load} openModal={setModal} />
      )}
      {tab === "products" && <ProductsPanel canManage={canManage} />}

      {modal.kind === "add-ingredient" && (
        <AddIngredientModal
          onClose={() => setModal({ kind: "none" })}
          onDone={() => {
            setModal({ kind: "none" });
            void load();
          }}
        />
      )}
      {modal.kind === "adjust" && (
        <AdjustModal
          ing={modal.ing}
          onClose={() => setModal({ kind: "none" })}
          onDone={() => {
            setModal({ kind: "none" });
            void load();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Ingredients ---------------- */

function IngredientsPanel({
  items, out, low, ok, err, canManage, onReload, openModal,
}: {
  items: Ingredient[];
  out: Ingredient[];
  low: Ingredient[];
  ok: Ingredient[];
  err: string;
  canManage: boolean;
  onReload(): Promise<void>;
  openModal(m: Modal): void;
}) {
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  return (
    <>
      <div className="card stat">
        <div className="lbl">Stock health</div>
        <div className="val" style={{ fontSize: 17 }}>
          <span className="badge bad">{out.length} out</span>{" "}
          <span className="badge warn">{low.length} low</span>{" "}
          <span className="badge ok">{ok.length} ok</span>
        </div>
        {canManage && (
          <button className="action-btn" style={{ marginTop: 10 }} onClick={() => openModal({ kind: "add-ingredient" })}>
            ＋ Add ingredient
          </button>
        )}
      </div>

      <div className="card">
        <h3>All ingredients</h3>
        {err && <div className="err">{err}</div>}
        {items.length === 0 && <div className="empty">No ingredients tracked yet</div>}
        {items.map((i) => (
          <div className="list-item" key={i.id}>
            <div className="l">
              <div>
                <div className="t">{i.name}</div>
                <div className="s">min {i.minStockQty}{i.unit}</div>
              </div>
            </div>
            <div className="r" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="mini-btn" onClick={() => setHistoryFor(historyFor === i.id ? null : i.id)}>
                history
              </button>
              {canManage && (
                <button className="mini-btn accent" onClick={() => openModal({ kind: "adjust", ing: i })}>
                  update
                </button>
              )}
              <span style={{ fontWeight: 800 }}>{i.stockQty}{i.unit}</span>
              <span className={`badge ${i.status === "out" ? "bad" : i.status === "low" ? "warn" : "ok"}`}>{i.status}</span>
            </div>
          </div>
        ))}
      </div>

      {historyFor && <HistoryCard id={historyFor} onDone={() => setHistoryFor(null)} />}
    </>
  );
}

function HistoryCard({ id, onDone }: { id: string; onDone(): void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    api<any[]>(`/ingredients/${id}/history`)
      .then((rs) => {
        setRows(rs);
        api<Ingredient[]>("/dashboard/low-stock").then((list) => {
          setName(list.find((i) => i.id === id)?.name ?? "");
        });
      })
      .catch(() => setRows([]));
  }, [id]);

  const icon: Record<string, string> = {
    sale: "☕", purchase: "📥", adjustment: "🛠", waste: "🗑", damage: "💥", stock_count: "📋", return: "↩️",
  };

  return (
    <div className="card">
      <h3>Movements — {name || "ingredient"}</h3>
      {rows.length === 0 && <div className="empty">No movements recorded</div>}
      {rows.slice(0, 15).map((r) => (
        <div className="list-item" key={r.id}>
          <div className="l">
            <div>
              <div className="t">{icon[r.type] ?? "•"} {r.type.replace("_", " ")} {r.deltaQty > 0 ? "+" : ""}{r.deltaQty}</div>
              <div className="s">{r.userName ?? "system"} · {new Date(r.createdAt).toLocaleString("en-GB")}{r.note ? ` · ${r.note}` : ""}</div>
            </div>
          </div>
          <div className="r">→ {r.balanceAfter}</div>
        </div>
      ))}
      <button className="mini-btn" style={{ marginTop: 8 }} onClick={onDone}>close</button>
    </div>
  );
}

/* ---------------- Products ---------------- */

function ProductsPanel({ canManage }: { canManage: boolean }) {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<any | null>(null); // null | "new" | product object
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [p, c] = await Promise.all([api<any[]>("/products?includeInactive=1"), api<any[]>("/categories")]);
      setProducts(p);
      setCategories(c);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleActive(p: any) {
    setBusy(true);
    try {
      await api(`/products/${p.id}`, { method: "PUT", body: { active: !p.active } });
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <>
      <div className="card stat">
        <div className="lbl">Menu</div>
        <div className="val" style={{ fontSize: 17 }}>
          {products.filter((p) => p.active).length} active · {products.filter((p) => !p.active).length} archived
        </div>
        {canManage && (
          <button className="action-btn" style={{ marginTop: 10 }} onClick={() => setEdit("new")}>
            ＋ Add product
          </button>
        )}
      </div>

      <div className="card">
        <h3>All products</h3>
        {err && <div className="err">{err}</div>}
        {products.length === 0 && <div className="empty">No products yet</div>}
        {products.map((p) => (
          <div className="list-item" key={p.id}>
            <div className="l">
              <div>
                <div className="t">{p.imageEmoji} {p.name}</div>
                <div className="s">{catName(p.categoryId)} · {p.available === "out" ? "marked out" : "available"}</div>
              </div>
            </div>
            <div className="r" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 800 }}>Rs {(p.price / 100).toFixed(0)}</span>
              {canManage && (
                <>
                  <button className="mini-btn" onClick={() => setEdit(p)}>edit</button>
                  <button className={`mini-btn ${p.active ? "" : "accent"}`} disabled={busy} onClick={() => toggleActive(p)}>
                    {p.active ? "archive" : "restore"}
                  </button>
                </>
              )}
              {!p.active && <span className="badge">archived</span>}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <ProductModal
          product={edit === "new" ? null : edit}
          categories={categories}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            void load();
          }}
        />
      )}
    </>
  );
}

/* ---------------- Modals ---------------- */

function ProductModal({
  product, categories, onClose, onDone,
}: {
  product: any | null;
  categories: any[];
  onClose(): void;
  onDone(): void;
}) {
  const [form, setForm] = useState({
    name: product?.name ?? "",
    emoji: product?.imageEmoji ?? "🍽️",
    categoryId: product?.categoryId ?? categories[0]?.id ?? "",
    price: product ? (product.price / 100).toFixed(0) : "",
    cost: product?.cost ? (product.cost / 100).toFixed(0) : "",
    description: product?.description ?? "",
    available: product ? product.available !== "out" : true,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim() || !form.categoryId) {
      setErr("Name and category are required");
      return;
    }
    const price = Math.round(parseFloat(form.price || "0") * 100);
    if (!price || price <= 0) {
      setErr("Enter a valid price");
      return;
    }
    setBusy(true);
    setErr("");
    const body: any = {
      name: form.name.trim(),
      imageEmoji: form.emoji || "🍽️",
      categoryId: form.categoryId,
      price,
      description: form.description.trim() || undefined,
      available: form.available ? "available" : "out",
    };
    if (form.cost) body.cost = Math.round(parseFloat(form.cost) * 100);
    try {
      if (product) {
        await api(`/products/${product.id}`, { method: "PUT", body });
      } else {
        await api("/products", { method: "POST", body });
      }
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{product ? `Edit ${product.name}` : "New product"}</h3>
        {err && <div className="err">{err}</div>}

        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Iced Caramel Latte" />
        </div>

        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>Emoji</label>
            <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={4} />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>Price (Rs)</label>
            <input type="number" min="1" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="850" />
          </div>
          <div className="field">
            <label>Cost (Rs, optional)</label>
            <input type="number" min="0" inputMode="numeric" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="300" />
          </div>
        </div>

        <div className="field">
          <label>Description</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — shows on receipts/reports" />
        </div>

        <label className="check-row">
          <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} />
          Available for ordering
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="ghost-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary-btn" style={{ marginTop: 0 }} onClick={save} disabled={busy || !form.name.trim() || !form.price}>
            {busy ? "Saving…" : product ? "Save changes" : "Add product"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddIngredientModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [form, setForm] = useState({ name: "", unit: "g", stockQty: "", minStockQty: "", purchasePrice: "", supplier: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim()) {
      setErr("Name is required");
      return;
    }
    setBusy(true);
    try {
      await api("/ingredients", {
        method: "POST",
        body: {
          name: form.name.trim(),
          unit: form.unit || "pcs",
          stockQty: parseFloat(form.stockQty || "0"),
          minStockQty: parseFloat(form.minStockQty || "0"),
          purchasePrice: form.purchasePrice ? Math.round(parseFloat(form.purchasePrice) * 100) : 0,
          supplier: form.supplier.trim() || undefined,
        },
      });
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>New ingredient</h3>
        {err && <div className="err">{err}</div>}
        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Oat Milk" />
        </div>
        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>Unit</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              <option value="g">grams (g)</option>
              <option value="ml">millilitres (ml)</option>
              <option value="pcs">pieces (pcs)</option>
            </select>
          </div>
          <div className="field">
            <label>Opening stock</label>
            <input type="number" min="0" inputMode="decimal" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} placeholder="0" />
          </div>
        </div>
        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>Min stock (alert below)</label>
            <input type="number" min="0" inputMode="decimal" value={form.minStockQty} onChange={(e) => setForm({ ...form, minStockQty: e.target.value })} placeholder="0" />
          </div>
          <div className="field">
            <label>Purchase price (Rs, optional)</label>
            <input type="number" min="0" inputMode="decimal" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} placeholder="per unit" />
          </div>
        </div>
        <div className="field">
          <label>Supplier</label>
          <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Optional" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="ghost-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary-btn" style={{ marginTop: 0 }} onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? "Saving…" : "Add ingredient"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ADJUST_TYPES = [
  { value: "purchase", label: "📥 Received stock", hint: "Delivery arrived — add quantity" },
  { value: "waste", label: "🗑 Waste / spillage", hint: "Removed stock, no sale" },
  { value: "damage", label: "💥 Damage", hint: "Broken / spoiled" },
  { value: "adjustment", label: "🛠 Correction", hint: "Fix a wrong count" },
  { value: "stock_count", label: "📋 Stock count", hint: "Set the exact counted quantity" },
] as const;

function AdjustModal({ ing, onClose, onDone }: { ing: Ingredient; onClose(): void; onDone(): void }) {
  const [type, setType] = useState<string>("purchase");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const num = parseFloat(qty);
  const valid = !isNaN(num) && num > 0 && (type !== "purchase" || num > 0);

  async function save() {
    const body: any = { type, note: note.trim() || undefined };
    if (type === "stock_count") {
      body.deltaQty = num; // absolute
    } else {
      body.deltaQty = type === "purchase" ? num : -num;
    }
    setBusy(true);
    try {
      await api(`/ingredients/${ing.id}/adjust`, { method: "POST", body });
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const preview =
    type === "stock_count" ? num : type === "purchase" ? ing.stockQty + (isNaN(num) ? 0 : num) : ing.stockQty - (isNaN(num) ? 0 : num);

  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Update stock — {ing.name}</h3>
        <div className="s" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Current: <b>{ing.stockQty}{ing.unit}</b>
        </div>
        {err && <div className="err">{err}</div>}

        <div className="seg" style={{ margin: "0 0 12px", flexWrap: "wrap" }}>
          {ADJUST_TYPES.map((t) => (
            <button key={t.value} className={type === t.value ? "active" : ""} onClick={() => setType(t.value)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="field">
          <label>{type === "stock_count" ? `Counted quantity (${ing.unit})` : `Quantity (${ing.unit})`}</label>
          <input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </div>

        <div className="field">
          <label>Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. morning delivery from supplier" />
        </div>

        {!isNaN(num) && num > 0 && (
          <div className="s" style={{ marginBottom: 10 }}>
            New level: <b>{preview}{ing.unit}</b>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="ghost-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary-btn" style={{ marginTop: 0 }} onClick={save} disabled={busy || !valid}>
            {busy ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
