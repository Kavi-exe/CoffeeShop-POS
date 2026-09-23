import { useEffect, useState } from "react";
import { usePos, watchSync } from "./lib/store.js";
import { startSyncLoop } from "./lib/sync-manager.js";
import { db } from "./lib/local-db.js";
import LoginScreen from "./screens/LoginScreen.js";
import PosScreen from "./screens/PosScreen.js";

export default function App() {
  const session = usePos((s) => s.session);
  const setSession = usePos((s) => s.setSession);
  const loadCatalog = usePos((s) => s.loadCatalog);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await db.session.get("current");
      if (saved) {
        await setSession({
          accessToken: saved.accessToken,
          refreshToken: saved.refreshToken,
          user: saved.user,
          deviceId: saved.deviceId,
          deviceName: saved.deviceName,
        });
      }
      await loadCatalog();
      setBooted(true);
    })();
    const stop = watchSync();
    startSyncLoop(15000);
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!booted) {
    return (
      <div className="login-screen">
        <div style={{ color: "var(--muted)" }}>Starting…</div>
      </div>
    );
  }

  return session ? <PosScreen /> : <LoginScreen />;
}
