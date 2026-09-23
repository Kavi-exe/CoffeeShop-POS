import { useMemo, useState } from "react";
import { usePos } from "../lib/store.js";
import { api } from "../lib/api.js";
import { getAckedOrder } from "../lib/sync-manager.js";
import { db } from "../lib/local-db.js";
import { openReceiptWindow } from "../lib/store.js";

type Method = "cash" | "card" | "bank_transfer" | "qr" | "split";

export default function PaymentModal({ onClose }: { onClose(): void }) {
  const cart = usePos((s) => s.cart);
  const totals = usePos((s) => s.totals);
  const clearCart = usePos((s) => s.clearCart);
  const orderType = usePos((s) => s.orderType);
  const tableId = usePos((s) => s.tableId);
  const customerNote = usePos((s) => s.customerNote);
  const deliveryInfo = usePos((s) => s.deliveryInfo);
  const orderDiscountCents = usePos((s) => s.orderDiscountCents);
  const online = usePos((s) => s.online);
  const session = usePos((s) => s.session)!;

  const grand = useMemo(() => totals(0, 10).total + (orderType === "delivery" ? (deliveryInfo?.feeCents ?? 0) : 0), [totals, orderType, deliveryInfo]);

  const [method, setMethod] = useState<Method>("cash");
  const [cashInput, setCashInput] = useState("");
  const [splitParts, setSplitParts] = useState<Array<{ method: Exclude<Method, "split">; amountRupees: string }>>([
    { method: "cash", amountRupees: "" },
    { method: "card", amountRupees: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ change: number; orderNo?: number; offline: boolean } | null>(null);
  const [error, setError] = useState("");

  const cashReceived = Math.round((parseFloat(cashInput || "0") || 0) * 100);
  const change = method === "cash" ? Math.max(0, cashReceived - grand) : 0;
  const shortCash = method === "cash" && cashReceived < grand;

  const splitSum = splitParts.reduce((s, p) => s + (Math.round((parseFloat(p.amountRupees || "0") || 0) * 100)), 0);
  const splitValid = method !== "split" || splitSum === grand;

  async function charge() {
    setBusy(true);
    setError("");
    try {
      // submit order (queued offline if needed)
      const { localId } = await usePos.getState().submitOrder();

      if (online) {
        // wait for the server ack (usually < 1s)
        let order: any = null;
        for (let i = 0; i < 20; i++) {
          order = await getAckedOrder<any>(localId);
          if (order) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!order) throw new Error("Server did not acknowledge the order in time");

        const paymentBody =
          method === "cash"
            ? { method: "cash", amountCents: grand, cashReceivedCents: cashReceived, idempotencyKey: `pay-${localId}` }
            : method === "split"
              ? {
                  method: "split",
                  amountCents: grand,
                  idempotencyKey: `pay-${localId}`,
                  splitParts: splitParts
                    .filter((p) => parseFloat(p.amountRupees) > 0)
                    .map((p) => ({ method: p.method, amountCents: Math.round(parseFloat(p.amountRupees) * 100) })),
                }
              : { method, amountCents: grand, idempotencyKey: `pay-${localId}` };

        const paid = await api<any>(`/orders/${order.id}/pay`, { method: "POST", body: paymentBody });
        await db.receipts.put({
          id: crypto.randomUUID(),
          orderNo: paid.orderNo,
          text: JSON.stringify(paid),
          createdAt: new Date().toISOString(),
        });
        setDone({ change, orderNo: paid.orderNo, offline: false });
      } else {
        // offline: payment recorded locally, receipt printed from cart snapshot
        setDone({ change, offline: true });
      }
      clearCart();
    } catch (err: any) {
      setError(err?.message ?? "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="modal-backdrop">
        <div className="modal" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 54 }}>✅</div>
          <h2>{done.offline ? "Sale recorded offline" : "Payment complete"}</h2>
          <p className="sub">
            {done.offline
              ? "Order & payment queued — will sync automatically"
              : `Order #${done.orderNo} sent to printers`}
          </p>
          {method === "cash" && (
            <div className="cash-display" style={{ textAlign: "left" }}>
              <div className="change-row"><span>Total</span><span className="val">Rs {(grand / 100).toFixed(2)}</span></div>
              <div className="change-row"><span>Cash received</span><span className="val">Rs {(cashReceived / 100).toFixed(2)}</span></div>
              <div className="change-row" style={{ fontSize: 20 }}>
                <span>Change due</span>
                <span className="val" style={{ color: "var(--green)" }}>Rs {(change / 100).toFixed(2)}</span>
              </div>
            </div>
          )}
          <button className="primary-btn" onClick={onClose}>New order</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Charge Rs {(grand / 100).toFixed(2)}</h2>
        <p className="sub">
          {orderType === "dine_in" ? "Dine-in" : orderType === "delivery" ? "Delivery" : "Takeaway"} · {cart.length} lines
          {!online && " · OFFLINE: payment will be queued"}
        </p>

        {error && <div className="err">{error}</div>}

        <div className="opt-row" style={{ marginBottom: 16 }}>
          {(["cash", "card", "bank_transfer", "qr", "split"] as Method[]).map((m) => (
            <button key={m} className={`opt-btn ${method === m ? "selected" : ""}`} onClick={() => setMethod(m)}>
              {m === "bank_transfer" ? "Transfer" : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {method === "cash" && (
          <>
            <div className="cash-display">
              <div className="lbl">Cash received</div>
              <div className="big">Rs {(cashReceived / 100).toFixed(2)}</div>
              <div className="change-row">
                <span>Change due</span>
                <span className="val" style={{ color: shortCash ? "var(--red)" : "var(--green)" }}>
                  Rs {(change / 100).toFixed(2)}{shortCash ? " (short)" : ""}
                </span>
              </div>
            </div>
            <div className="num-pad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0, "00", "C"].map((k) => (
                <button
                  key={String(k)}
                  onClick={() => {
                    if (k === "C") setCashInput("");
                    else setCashInput((v) => (v + String(k)).replace(/^0+(?=\d)/, ""));
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="opt-row">
              {[grand, 100000, 200000, 500000].map((amt, i) => (
                <button key={i} className="opt-btn" onClick={() => setCashInput((amt / 100).toFixed(0))}>
                  {amt === grand ? "Exact" : `Rs ${(amt / 100).toFixed(0)}`}
                </button>
              ))}
            </div>
          </>
        )}

        {method === "split" && (
          <div>
            {splitParts.map((p, i) => (
              <div key={i} className="field">
                <label>Part {i + 1} — {p.method}</label>
                <input
                  inputMode="decimal"
                  value={p.amountRupees}
                  onChange={(e) =>
                    setSplitParts((prev) => prev.map((x, j) => (j === i ? { ...x, amountRupees: e.target.value } : x)))
                  }
                  placeholder="0.00"
                />
              </div>
            ))}
            <div className="totals-row">
              <span>Allocated</span>
              <span>Rs {(splitSum / 100).toFixed(2)} / Rs {(grand / 100).toFixed(2)}</span>
            </div>
            {!splitValid && <div className="err">Split parts must add up to the total</div>}
          </div>
        )}

        {(method === "card" || method === "bank_transfer" || method === "qr") && (
          <div className="cash-display">
            <div className="lbl">Amount</div>
            <div className="big">Rs {(grand / 100).toFixed(2)}</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {method === "card" && "Terminal prompt will appear on the card machine"}
              {method === "bank_transfer" && "Ask for the transfer reference"}
              {method === "qr" && "Customer scans the café QR and pays"}
            </div>
          </div>
        )}

        <button className="primary-btn" onClick={charge} disabled={busy || shortCash || !splitValid}>
          {busy ? "Processing…" : `Confirm ${method === "cash" ? "cash" : ""} payment`}
        </button>
        <button className="ghost-btn" onClick={onClose}>Back</button>
      </div>
    </div>
  );
}
