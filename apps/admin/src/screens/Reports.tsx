import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

type Range = "today" | "week" | "month";
const DAYS: Record<Range, number> = { today: 1, week: 7, month: 30 };

export default function ReportsScreen() {
  const [range, setRange] = useState<Range>("week");
  const [hourly, setHourly] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [cashiers, setCashiers] = useState<any[]>([]);
  const [daily, setDaily] = useState<any[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const days = DAYS[range];
    try {
      const [h, c, p, ca, d] = await Promise.all([
        api("/dashboard/hourly"),
        api(`/dashboard/categories?days=${days}`),
        api(`/dashboard/payments?days=${days}`),
        api(`/dashboard/cashiers?days=${days}`),
        api(`/dashboard/daily?days=${days === 1 ? 7 : days}`),
      ]);
      setHourly(h); setCategories(c); setPayments(p); setCashiers(ca); setDaily(d);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    const rows = [["date", "orders", "revenue"], ...daily.map((d) => [d.date, d.orders, (d.revenue / 100).toFixed(2)])];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brewbean-sales-${range}.csv`;
    a.click();
  }

  const maxHour = Math.max(1, ...hourly.map((h) => h.revenue));
  const payTotal = Math.max(1, payments.reduce((s, p) => s + p.revenue, 0));

  return (
    <div>
      <div className="seg">
        {(["today", "week", "month"] as Range[]).map((r) => (
          <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
            {r === "today" ? "Today" : r === "week" ? "7 days" : "30 days"}
          </button>
        ))}
        <button style={{ flex: "0 0 84px" }} onClick={exportCsv}>⬇ CSV</button>
      </div>

      <div className="card">
        <h3>Hourly sales today</h3>
        <div className="bars">
          {hourly.map((h) => (
            <div key={h.hour} className="bar-col" title={`${h.hour}:00 — Rs ${(h.revenue / 100).toFixed(0)}`}>
              <div className="bar" style={{ height: `${Math.max(3, (h.revenue / maxHour) * 100)}%` }} />
              <div className="bar-lbl">{h.hour}</div>
            </div>
          ))}
          {hourly.length === 0 && <div className="empty">No sales yet today</div>}
        </div>
      </div>

      {err && <div className="card"><div className="err">{err}</div></div>}

      <div className="card">
        <h3>Category performance</h3>
        {categories.map((c) => (
          <div className="list-item" key={c.category}>
            <span className="t">{c.category}</span>
            <span className="r">Rs {(c.revenue / 100).toLocaleString()} <span className="s">×{c.qty}</span></span>
          </div>
        ))}
        {categories.length === 0 && <div className="empty">No data</div>}
      </div>

      <div className="card">
        <h3>Payment methods</h3>
        {payments.map((p) => (
          <div className="list-item" key={p.method}>
            <span className="t">{p.method.replace("_", " ")}</span>
            <span className="r">Rs {(p.revenue / 100).toLocaleString()} <span className="s">{Math.round((p.revenue / payTotal) * 100)}%</span></span>
          </div>
        ))}
        {payments.length === 0 && <div className="empty">No data</div>}
      </div>

      <div className="card">
        <h3>Cashier performance</h3>
        {cashiers.map((c) => (
          <div className="list-item" key={c.name}>
            <span className="t">{c.name}</span>
            <span className="r">{c.orders} orders · Rs {(c.sales / 100).toLocaleString()}</span>
          </div>
        ))}
        {cashiers.length === 0 && <div className="empty">No data</div>}
      </div>
    </div>
  );
}
