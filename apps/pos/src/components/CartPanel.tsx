import { useMemo, useState } from "react";
import { usePos } from "../lib/store.js";
import type { OrderTotals } from "@brewbean/shared";
import LineDiscountModal from "./LineDiscountModal.js";

const CAFE = {
  name: "BrewBean Café",
  address: "42 Palm Avenue, Colombo 03",
  phone: "+94 11 234 5678",
  footer: "Thank you for visiting BrewBean Café! ☕",
};

export default function CartPanel({ onPay, onHold, onCancel }: { onPay(): void; onHold(): void; onCancel(): void }) {
  const cart = usePos((s) => s.cart);
  const products = usePos((s) => s.products);
  const orderType = usePos((s) => s.orderType);
  const setOrderType = usePos((s) => s.setOrderType);
  const tableId = usePos((s) => s.tableId);
  const incLine = usePos((s) => s.incLine);
  const removeLine = usePos((s) => s.removeLine);
  const setLineNote = usePos((s) => s.setLineNote);
  const totals = usePos((s) => s.totals);
  const session = usePos((s) => s.session);
  const online = usePos((s) => s.online);
  const deliveryInfo = usePos((s) => s.deliveryInfo);

  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const orderDiscountCents = usePos((s) => s.orderDiscountCents);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [orderDiscountOpen, setOrderDiscountOpen] = useState(false);
  const [orderDiscountInput, setOrderDiscountInput] = useState("");

  const t: OrderTotals = useMemo(() => totals(0, 10), [totals, cart, orderDiscountCents]);

  const deliveryFee = orderType === "delivery" ? (deliveryInfo?.feeCents ?? 0) : 0;
  const grand = t.total + deliveryFee;

  return (
    <div className="cart">
      <div className="cart-head">
        <div className="order-type">
          {(["dine_in", "takeaway", "delivery"] as const).map((ot) => (
            <button key={ot} className={`otype-btn ${orderType === ot ? "active" : ""}`} onClick={() => setOrderType(ot)}>
              {ot === "dine_in" ? "Dine-In" : ot === "takeaway" ? "Takeaway" : "Delivery"}
            </button>
          ))}
        </div>
        <div className="order-no">
          {orderType === "dine_in" && tableId ? `Dine-in · table selected` : orderType === "delivery" && deliveryInfo ? `Delivery · ${deliveryInfo.customerName}` : "New order"}
          {" · "}
          {session?.deviceName ?? ""}
          {!online && " · will sync when online"}
        </div>
      </div>

      <div className="cart-lines">
        {cart.length === 0 && <div className="cart-empty">Tap products to add them<br />to this order</div>}
        {cart.map((line) => {
          const p = products.find((x) => x.id === line.productId);
          const mods = (p?.modifierGroups ?? []).flatMap((g) => g.options).filter((o) => line.modifierOptionIds.includes(o.id));
          const unit = (p?.price ?? 0) + mods.reduce((s, o) => s + o.priceDelta, 0);
          return (
            <div key={line.lineId} className="cart-line">
              <div className="row1">
                <div className="pname">{p?.name ?? "?"}</div>
                <div className="amount">Rs {((unit * line.qty - line.discountCents) / 100).toFixed(2)}</div>
              </div>
              {mods.length > 0 && <div className="pmods">{mods.map((m) => m.name).join(" · ")}</div>}
              {line.note && <div className="pmods">📝 {line.note}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <div className="qty-ctrl">
                  <button className="qty-btn" onClick={() => incLine(line.lineId, -1)}>−</button>
                  <span style={{ fontWeight: 800, minWidth: 22, textAlign: "center" }}>{line.qty}</span>
                  <button className="qty-btn plus" onClick={() => incLine(line.lineId, 1)}>+</button>
                </div>
                <div className="tools">
                  <button className="tool-btn" onClick={() => setDiscountFor(line.lineId)}>Disc</button>
                  <button
                    className="tool-btn"
                    onClick={() => {
                      setNoteFor(line.lineId);
                      setNoteText(line.note ?? "");
                    }}
                  >
                    Note
                  </button>
                  <button className="tool-btn danger" onClick={() => removeLine(line.lineId)}>✕</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cart-foot">
        <div className="totals-row">
          <span>Subtotal</span>
          <span>Rs {(t.subtotal / 100).toFixed(2)}</span>
        </div>
        {t.orderDiscount > 0 && (
          <div className="totals-row" style={{ color: "var(--accent-soft)" }}>
            <span>Order discount</span>
            <span>−Rs {(t.orderDiscount / 100).toFixed(2)}</span>
          </div>
        )}
        {t.serviceCharge > 0 && (
          <div className="totals-row">
            <span>Service charge (10%)</span>
            <span>Rs {(t.serviceCharge / 100).toFixed(2)}</span>
          </div>
        )}
        {deliveryFee > 0 && (
          <div className="totals-row">
            <span>Delivery fee</span>
            <span>Rs {(deliveryFee / 100).toFixed(2)}</span>
          </div>
        )}
        <div className="totals-row grand">
          <span>Total</span>
          <span>Rs {(grand / 100).toFixed(2)}</span>
        </div>

        <div className="cart-actions">
          <button className="secondary-btn" onClick={() => setOrderDiscountOpen(true)}>Discount</button>
          <button className="secondary-btn" onClick={onHold}>Hold</button>
          <button className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button className="pay-btn" onClick={onPay} disabled={cart.length === 0}>
            Charge · Rs {(grand / 100).toFixed(2)}
          </button>
        </div>
      </div>

      {discountFor && <LineDiscountModal lineId={discountFor} onClose={() => setDiscountFor(null)} />}

      {noteFor && (
        <div className="modal-backdrop" onClick={() => setNoteFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Item note</h2>
            <p className="sub">Printed on the kitchen ticket</p>
            <div className="field">
              <textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="No onions, extra hot…" />
            </div>
            <button
              className="primary-btn"
              onClick={() => {
                setLineNote(noteFor, noteText);
                setNoteFor(null);
              }}
            >
              Save note
            </button>
          </div>
        </div>
      )}

      {orderDiscountOpen && (
        <div className="modal-backdrop" onClick={() => setOrderDiscountOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Order discount</h2>
            <p className="sub">Amount in rupees — audited on the server</p>
            <div className="field">
              <input
                autoFocus
                inputMode="decimal"
                value={orderDiscountInput}
                onChange={(e) => setOrderDiscountInput(e.target.value)}
                placeholder="e.g. 250"
              />
            </div>
            <button
              className="primary-btn"
              onClick={() => {
                usePos.getState().setOrderDiscount(Math.round(parseFloat(orderDiscountInput || "0") * 100));
                setOrderDiscountOpen(false);
                setOrderDiscountInput("");
              }}
            >
              Apply discount
            </button>
            <button className="ghost-btn" onClick={() => setOrderDiscountOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
