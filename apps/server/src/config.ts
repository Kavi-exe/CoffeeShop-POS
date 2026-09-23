import fs from "node:fs";
import path from "node:path";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, "brewbean.db"),
  printDir: path.resolve(process.env.PRINT_DIR ?? path.join(DATA_DIR, "print-jobs")),
  printHistoryDir: path.resolve(
    process.env.PRINT_HISTORY_DIR ?? path.join(DATA_DIR, "print-history")
  ),
  printSink: (process.env.PRINT_SINK ?? "file") as "network" | "file" | "cups",
  jwtSecret: required("JWT_SECRET", "dev-only-secret-change-me-64-hex-chars-required"),
  jwtRefreshSecret: required(
    "JWT_REFRESH_SECRET",
    "dev-only-refresh-secret-change-me-64-hex-chars-required"
  ),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14),
  cloud: {
    apiUrl: process.env.CLOUD_API_URL ?? "", // empty = run fully offline
    apiToken: process.env.CLOUD_API_TOKEN ?? "",
    deviceId: process.env.CLOUD_DEVICE_ID ?? "cafe-local-01",
    intervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 5000),
    batchSize: Number(process.env.SYNC_BATCH_SIZE ?? 200),
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
};

export type Config = typeof config;
