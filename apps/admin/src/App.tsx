import { useCallback, useEffect, useState } from "react";
import { authStore, api, openEventStream } from "./lib/api.js";
import Login from "./screens/Login.js";
import Dashboard from "./screens/Dashboard.js";
import OrdersScreen from "./screens/Orders.js";
import InventoryScreen from "./screens/Inventory.js";
import ReportsScreen from "./screens/Reports.js";
import MoreScreen from "./screens/More.js";

const TABS = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "orders", label: "Orders", icon: "🧾" },
  { id: "inventory", label: "Stock", icon: "📦" },
  { id: "reports", label: "Reports", icon: "📊" },
  { id: "more", label: "More", icon: "⚙️" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [authed, setAuthed] = useState(!!authStore.accessToken);
  const [tab, setTab] = useState<TabId>("home");
  const [theme, setTheme] = useState(localStorage.getItem("bb.theme") ?? "light");
  const [tick, setTick] = useState(0);
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("bb.theme", theme);
  }, [theme]);

  const refreshNotifications = useCallback(async () => {
    if (!authStore.accessToken) return;
    try {
      const list = await api<any[]>("/notifications");
      setNotifCount(list.filter((n) => !n.read).length);
    } catch {
      /* offline tolerated */
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshNotifications();
    // SSE: live sale/order events trigger data refresh across screens
    const stop = openEventStream((event) => {
      if (event === "sale" || event === "order" || event === "notification") {
        setTick((t) => t + 1);
        if (event === "notification") void refreshNotifications();
      }
    });
    return stop;
  }, [authed, refreshNotifications]);

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="app">
      <div className="header">
        <div className="row">
          <div>
            <h1>BrewBean Café</h1>
            <div className="date">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · live</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="icon-btn" onClick={() => setTab("more")}>
              🔔{notifCount > 0 && <span className="dot">{notifCount}</span>}
            </button>
          </div>
        </div>
      </div>

      <div key={tick} style={{ minHeight: "60vh" }}>
        {tab === "home" && <Dashboard />}
        {tab === "orders" && <OrdersScreen />}
        {tab === "inventory" && <InventoryScreen />}
        {tab === "reports" && <ReportsScreen />}
        {tab === "more" && <MoreScreen onLogout={() => { authStore.clear(); setAuthed(false); }} />}
      </div>

      <div className="bottom-nav">
        <div className="inner">
          {TABS.map((t) => (
            <button key={t.id} className={`nav-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <span className="ico">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
