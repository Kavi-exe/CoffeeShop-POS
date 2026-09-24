import { useEffect, useMemo, useState } from "react";
import { usePos } from "../lib/store.js";
import { db } from "../lib/local-db.js";
import type { Product, Category, ModifierOption } from "@brewbean/shared";
import CartPanel from "../components/CartPanel.js";
import ModifierModal from "../components/ModifierModal.js";
import PaymentModal from "../components/PaymentModal.js";
import HoldModal from "../components/HoldModal.js";
import DeliveryModal from "../components/DeliveryModal.js";
import { syncNow } from "../lib/sync-manager.js";
import { useTheme } from "../lib/theme.js";

export default function PosScreen() {
  const session = usePos((s) => s.session)!;
  const categories = usePos((s) => s.categories);
  const products = usePos((s) => s.products);
  const online = usePos((s) => s.online);
  const pendingCount = usePos((s) => s.pendingCount);
  const addProduct = usePos((s) => s.addProduct);
  const clearCart = usePos((s) => s.clearCart);
  const loadCatalog = usePos((s) => s.loadCatalog);
  const orderType = usePos((s) => s.orderType);
  const tableId = usePos((s) => s.tableId);

  const [clock, setClock] = useState(() => new Date());
  const [activeCat, setActiveCat] = useState<string>("all");
  const [modifierFor, setModifierFor] = useState<Product | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const t = setInterval(() => void loadCatalog(), 30000);
    return () => clearInterval(t);
  }, [loadCatalog]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (orderType === "delivery") setDeliveryOpen(true);
  }, [orderType]);

  const visible = useMemo(
    () =>
      products.filter(
        (p) =>
          (activeCat === "all" || p.categoryId === activeCat) &&
          p.available !== "out"
      ),
    [products, activeCat]
  );

  function tapProduct(p: Product) {
    if (p.allowModifiers && (p.modifierGroups?.length ?? 0) > 0) {
      setModifierFor(p);
    } else {
      addProduct(p, []);
    }
  }

  async function logout() {
    await db.session.clear();
    location.reload();
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Brew<span>Bean</span>
        </div>
        <button className={`chip ${online ? "online" : "offline"}`} onClick={() => void syncNow()}>
          {online ? "● Online" : "○ Offline"}
          {pendingCount > 0 && ` · ${pendingCount} queued`}
        </button>
        <span className="chip clock-chip">
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {clock.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
        </span>
        <div className="spacer" />
        <button className="chip" onClick={toggle} title="Toggle light/dark theme">
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>
        <button className="chip held-chip" onClick={() => setHoldOpen(true)}>
          Held orders
        </button>
        <div className="user-chip">
          <div className="avatar">{session.user.name.slice(0, 1)}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{session.user.name}</div>
            <div style={{ color: "var(--muted)", fontSize: 11.5, textTransform: "capitalize" }}>
              {session.user.role}
            </div>
          </div>
        </div>
        <button className="chip" onClick={logout}>
          Sign out
        </button>
      </div>

      <div className="categories-bar">
        <button className={`cat-chip ${activeCat === "all" ? "active" : ""}`} onClick={() => setActiveCat("all")}>
          All
        </button>
        {categories.map((c: Category) => (
          <button
            key={c.id}
            className={`cat-chip ${activeCat === c.id ? "active" : ""}`}
            onClick={() => setActiveCat(c.id)}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <div className="main">
        <div className="catalog">
          {visible.map((p: Product) => (
            <button key={p.id} className={`product-card ${p.available === "out" ? "out" : ""}`} onClick={() => tapProduct(p)}>
              {p.available === "low" && <span className="badge low">LOW</span>}
              <div className="emoji">{p.imageEmoji}</div>
              <div className="name">{p.name}</div>
              <div className="price">Rs {(p.price / 100).toFixed(2)}</div>
            </button>
          ))}
          {visible.length === 0 && (
            <div style={{ color: "var(--muted)", gridColumn: "1/-1", textAlign: "center", marginTop: 80 }}>
              No products in this category yet.
            </div>
          )}
        </div>

        <CartPanel
          onPay={() => setPayOpen(true)}
          onHold={() => setHoldOpen(true)}
          onCancel={() => {
            if (confirm("Cancel this order?")) clearCart();
          }}
        />
      </div>

      {modifierFor && (
        <ModifierModal
          product={modifierFor}
          onClose={() => setModifierFor(null)}
          onConfirm={(options: ModifierOption[]) => {
            addProduct(modifierFor, options.map((o) => o.id));
            setModifierFor(null);
          }}
        />
      )}
      {payOpen && <PaymentModal onClose={() => setPayOpen(false)} />}
      {holdOpen && <HoldModal onClose={() => setHoldOpen(false)} />}
      {deliveryOpen && (
        <DeliveryModal
          onClose={() => setDeliveryOpen(false)}
          onSave={() => setDeliveryOpen(false)}
        />
      )}
      {orderType === "dine_in" && !tableId && <TableModalWrapper />}
    </div>
  );
}

function TableModalWrapper() {
  const setTable = usePos((s) => s.setTable);
  const [tables, setTables] = useState<Array<{ id: string; name: string; zone: string }>>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch("/v1/tables")
      .then((r) => r.json())
      .then(setTables)
      .catch(() => setTables([]));
  }, []);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Select table</h2>
        <p className="sub">Dine-in orders need a table</p>
        <div className="table-grid">
          {tables.map((t) => (
            <button
              key={t.id}
              className="table-btn"
              onClick={() => {
                setTable(t.id);
                setOpen(false);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
