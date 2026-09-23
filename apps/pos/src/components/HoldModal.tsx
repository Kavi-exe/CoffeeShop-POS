import { useEffect, useState } from "react";
import { usePos } from "../lib/store.js";
import { db, type LocalHeldOrder } from "../lib/local-db.js";

export default function HoldModal({ onClose }: { onClose(): void }) {
  const cart = usePos((s) => s.cart);
  const clearCart = usePos((s) => s.clearCart);
  const [held, setHeld] = useState<LocalHeldOrder[]>([]);
  const [label, setLabel] = useState("");

  async function refresh() {
    setHeld(await db.heldOrders.orderBy("heldAt").reverse().toArray());
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function holdCurrent() {
    if (cart.length === 0) return;
    const id = crypto.randomUUID();
    await db.heldOrders.put({
      id,
      label: label || `Hold ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
      cartJson: JSON.stringify(usePos.getState().cart),
      heldAt: new Date().toISOString(),
    });
    setLabel("");
    clearCart();
    void refresh();
  }

  async function resume(id: string) {
    const row = await db.heldOrders.get(id);
    if (!row) return;
    usePos.setState({ cart: JSON.parse(row.cartJson) });
    await db.heldOrders.delete(id);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Hold / resume orders</h2>
        <p className="sub">Parked carts stay on this device until resumed</p>

        {cart.length > 0 && (
          <>
            <div className="field">
              <label>Label for current cart (e.g. Table 04, Anna)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Table 04" />
            </div>
            <button className="primary-btn" onClick={holdCurrent}>Hold current order</button>
          </>
        )}

        <div style={{ marginTop: 14 }}>
          {held.length === 0 && <div style={{ color: "var(--muted)", textAlign: "center" }}>No held orders</div>}
          {held.map((h) => (
            <div key={h.id} className="cart-line">
              <div className="row1">
                <div className="pname">{h.label}</div>
                <button className="tool-btn" onClick={() => resume(h.id)}>Resume →</button>
              </div>
              <div className="pmods">{JSON.parse(h.cartJson).length} lines · held {new Date(h.heldAt).toLocaleTimeString("en-GB")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
