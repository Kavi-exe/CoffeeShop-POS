import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

const FILTERS = ["all", "completed", "open", "held", "cancelled", "refunded"] as const;

export default function OrdersScreen() {
  const [orders, setOrders] = useState<any[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `?status=${filter}&`;
      setOrders(await api(`/orders${q}limit=60`));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refund(orderId: string, total: number) {
    const amount = prompt("Refund amount (Rs)", (total / 100).toFixed(2));
    if (!amount) return;
    const reason = prompt("Reason", "customer request");
    if (!reason) return;
    try {
      // refund lives on the local server; cloud mirrors it after sync.
      // The cloud dashboard records the intent via audit; actual money moves at the café.
      await api(`/orders/${orderId}/refund-remote`, {
        method: "POST",
        body: { amountCents: Math.round(parseFloat(amount) * 100), reason },
      });
      await load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <div className="seg">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <div className="card">
        {err && <div className="err">{err}</div>}
        {orders.length === 0 && <div className="empty">No orders</div>}
        {orders.map((o) => (
          <div className="list-item" key={o.id}>
            <div className="l">
              <div>
                <div className="t">#{o.orderNo} · {o.cashierName}</div>
                <div className="s">
                  {new Date(o.createdAt).toLocaleString("en-GB")} · {o.type.replace("_", "-")}
                  {o.tableName ? ` · ${o.tableName}` : ""} · {o.deviceId}
                </div>
              </div>
            </div>
            <div className="r" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Rs {(o.total / 100).toLocaleString()}
              <span className={`badge ${o.status === "completed" ? "ok" : ["cancelled", "refunded"].includes(o.status) ? "bad" : "warn"}`}>
                {o.status}
              </span>
              {["completed", "paid", "partially_refunded"].includes(o.status) && (
                <button className="badge bad" style={{ border: "none" }} onClick={() => refund(o.id, o.total)}>
                  refund
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
