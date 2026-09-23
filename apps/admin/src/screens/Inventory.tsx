import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export default function InventoryScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/dashboard/low-stock")
      .then(setItems)
      .catch((e) => setErr(e.message));
  }, []);

  const out = items.filter((i) => i.status === "out");
  const low = items.filter((i) => i.status === "low");
  const ok = items.filter((i) => i.status === "ok");

  return (
    <div>
      <div className="card stat">
        <div className="lbl">Stock health</div>
        <div className="val" style={{ fontSize: 17 }}>
          <span className="badge bad">{out.length} out</span>{" "}
          <span className="badge warn">{low.length} low</span>{" "}
          <span className="badge ok">{ok.length} ok</span>
        </div>
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
              <span style={{ fontWeight: 800 }}>{i.stockQty}{i.unit}</span>
              <span className={`badge ${i.status === "out" ? "bad" : i.status === "low" ? "warn" : "ok"}`}>{i.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
