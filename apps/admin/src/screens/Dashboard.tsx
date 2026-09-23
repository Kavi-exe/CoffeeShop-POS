import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [top, setTop] = useState<any[]>([]);
  const [low, setLow] = useState<any[]>([]);
  const [devices, setDevices] = useState<{ devices: any[]; printers: any[] }>({ devices: [], printers: [] });
  const [recent, setRecent] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [s, d, t, l, dev, o] = await Promise.all([
          api("/dashboard/summary"),
          api("/dashboard/daily?days=14"),
          api("/dashboard/top-products?days=7&limit=5"),
          api("/dashboard/low-stock"),
          api("/devices"),
          api("/orders?limit=5"),
        ]);
        setSummary(s);
        setDaily(d);
        setTop(t);
        setLow(l);
        setDevices(dev);
        setRecent(o);
      } catch (err: any) {
        setError(err.message);
      }
    })();
  }, []);

  const user = JSON.parse(localStorage.getItem("bb.user") ?? '{"name":"Owner"}');
  const maxRev = Math.max(1, ...daily.map((d) => d.revenue));

  return (
    <div>
      {error && <div className="card"><div className="err">{error}</div></div>}

      <div className="card">
        <h3>{greeting()}, {user.name}</h3>
        <div className="stat">
          <div className="lbl">Today's Revenue</div>
          <div className="val accent">Rs {((summary?.revenue ?? 0) / 100).toLocaleString()}</div>
        </div>
      </div>

      <div className="grid-2" style={{ margin: "0 12px" }}>
        <div className="card stat">
          <div className="lbl">Orders</div>
          <div className="val">{summary?.orders ?? 0}</div>
          <div className="sub">{summary?.activeOrders ?? 0} active right now</div>
        </div>
        <div className="card stat">
          <div className="lbl">Average Order</div>
          <div className="val">Rs {(((summary?.avgOrderValue ?? 0) / 100)).toLocaleString()}</div>
        </div>
        <div className="card stat">
          <div className="lbl">Estimated Profit</div>
          <div className="val green">Rs {((summary?.estimatedProfit ?? 0) / 100).toLocaleString()}</div>
        </div>
        <div className="card stat">
          <div className="lbl">Cash · Card · Online</div>
          <div className="val" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Rs {((summary?.cashSales ?? 0) / 100).toLocaleString()}<br />
            Rs {((summary?.cardSales ?? 0) / 100).toLocaleString()}<br />
            Rs {((summary?.onlineSales ?? 0) / 100).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Daily sales — last 14 days</h3>
        <div className="bars">
          {daily.map((d) => (
            <div key={d.date} className="bar-col" title={`${d.date}: Rs ${(d.revenue / 100).toFixed(0)} (${d.orders} orders)`}>
              <div className="bar" style={{ height: `${Math.max(3, (d.revenue / maxRev) * 100)}%` }} />
              <div className="bar-lbl">{d.date.slice(8)}</div>
            </div>
          ))}
          {daily.length === 0 && <div className="empty">No sales yet</div>}
        </div>
      </div>

      <div className="card">
        <h3>Top selling products (7d)</h3>
        {top.map((p, i) => (
          <div className="list-item" key={p.id ?? i}>
            <div className="l"><span className="t">{p.name}</span></div>
            <div className="r">Rs {(p.revenue / 100).toLocaleString()} <span className="s">×{p.qty}</span></div>
          </div>
        ))}
        {top.length === 0 && <div className="empty">No product sales yet</div>}
      </div>

      <div className="card">
        <h3>Low stock alerts</h3>
        {low.filter((i) => i.status !== "ok").slice(0, 5).map((i) => (
          <div className="list-item" key={i.id}>
            <div className="l"><span className="t">{i.name}</span></div>
            <div className="r">
              <span className={`badge ${i.status === "out" ? "bad" : "warn"}`}>{i.status}</span>{" "}
              <span className="s">{i.stockQty}{i.unit}</span>
            </div>
          </div>
        ))}
        {low.filter((i) => i.status !== "ok").length === 0 && <div className="empty">All stock levels healthy ✓</div>}
      </div>

      <div className="card">
        <h3>Recent orders</h3>
        {recent.map((o) => (
          <div className="list-item" key={o.id}>
            <div className="l">
              <div>
                <div className="t">#{o.orderNo} · {o.cashierName}</div>
                <div className="s">{new Date(o.createdAt).toLocaleTimeString("en-GB")} · {o.type.replace("_", "-")}{o.tableName ? ` · ${o.tableName}` : ""}</div>
              </div>
            </div>
            <div className="r">
              Rs {(o.total / 100).toLocaleString()} <span className={`badge ${o.status === "completed" ? "ok" : o.status === "cancelled" || o.status === "refunded" ? "bad" : ""}`}>{o.status.slice(0, 4)}</span>
            </div>
          </div>
        ))}
        {recent.length === 0 && <div className="empty">No orders yet today</div>}
      </div>

      <div className="card">
        <h3>Devices &amp; printers</h3>
        {devices.devices.map((d) => (
          <div className="list-item" key={d.id}>
            <div className="l"><span className="t">{d.name}</span><span className="s">{d.kind}</span></div>
            <div className="r"><span className={`badge ${d.reachable ? "ok" : "bad"}`}>{d.reachable ? "online" : "offline"}</span></div>
          </div>
        ))}
        {devices.printers.map((p) => (
          <div className="list-item" key={p.id}>
            <div className="l"><span className="t">{p.name}</span><span className="s">{p.kind}</span></div>
            <div className="r"><span className={`badge ${p.status === "online" ? "ok" : p.status === "offline" || p.status === "error" ? "bad" : ""}`}>{p.status}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
