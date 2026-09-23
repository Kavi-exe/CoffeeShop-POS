const API_URL = (import.meta as any).env?.VITE_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface TokenProvider {
  get(): { accessToken: string; refreshToken: string } | null;
  onRefreshed(accessToken: string, refreshToken: string): void;
  onAuthFailure(): void;
}

let provider: TokenProvider | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function configureApi(p: TokenProvider): void {
  provider = p;
}

async function tryRefresh(): Promise<boolean> {
  if (!provider) return false;
  const tokens = provider.get();
  if (!tokens?.refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        provider!.onRefreshed(body.accessToken, body.refreshToken);
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

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; retry?: boolean } = {}
): Promise<T> {
  const tokens = provider?.get();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tokens?.accessToken) headers["authorization"] = `Bearer ${tokens.accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline");
  }

  if (res.status === 401 && opts.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(path, { ...opts, retry: false });
    provider?.onAuthFailure();
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
