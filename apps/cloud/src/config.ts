function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8090),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: required(
    "DATABASE_URL",
    "postgres://brewbean:brewbean_dev@localhost:5432/brewbean_cloud"
  ),
  jwtSecret: required("JWT_SECRET", "dev-cloud-jwt-secret-change-me"),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "30m",
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14),
  deviceIngestToken: required("DEVICE_INGEST_TOKEN", "dev-cloud-token"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  ownerEmail: process.env.OWNER_EMAIL ?? "owner@brewbean.cafe",
  ownerPassword: process.env.OWNER_PASSWORD ?? "change-me-owner123",
  ownerName: process.env.OWNER_NAME ?? "Café Owner",
};
