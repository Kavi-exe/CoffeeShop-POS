const API_URL = (import.meta as any).env?.VITE_API_URL ?? "";

const store = {
  get accessToken() {
    return localStorage.getItem("bb.access") ?? "";
  },
  get refreshToken() {
    return localStorage.getItem("bb.refresh") ?? "";
  },
  set(access: string, refresh: string) {
    localStorage.setItem("bb.access", access);
    localStorage.setItem("bb.refresh", refresh);
  },
  clear() {
    localStorage.removeItem("bb.access");
    localStorage.removeItem("bb.refresh");
    localStorage.removeItem("bb.user");
  },
};

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!store.refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: store.refreshToken }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        store.set(body.accessToken, body.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(store.accessToken ? { authorization: `Bearer ${store.accessToken}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && opts.retry !== false) {
    if (await tryRefresh()) return api<T>(path, { ...opts, retry: false });
    store.clear();
    location.href = "/";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch { /* default */ }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const authStore = store;

export function openEventStream(onEvent: (event: string, data: any) => void): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  let retryMs = 2000;

  function connect() {
    if (stopped) return;
    es = new EventSource(`${API_URL}/v1/stream`);
    es.addEventListener("sale", (e) => onEvent("sale", JSON.parse((e as MessageEvent).data)));
    es.addEventListener("order", (e) => onEvent("order", JSON.parse((e as MessageEvent).data)));
    es.addEventListener("notification", (e) => onEvent("notification", JSON.parse((e as MessageEvent).data)));
    es.addEventListener("ping", () => undefined);
    es.onerror = () => {
      es?.close();
      if (!stopped) {
        setTimeout(connect, retryMs);
        retryMs = Math.min(30000, retryMs * 2);
      }
    };
    es.onopen = () => {
      retryMs = 2000;
    };
  }
  connect();
  return () => {
    stopped = true;
    es?.close();
  };
}
