import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";
import { migrate } from "./migrate.js";
import { ensureOwnerUser } from "./services/auth.js";
import {
  authenticate, rotateRefresh, revokeRefresh, verifyAccessToken, signAccessToken, type Claims,
} from "./services/auth.js";
import { ingestBatch } from "./services/ingest.js";
import * as reports from "./services/reports.js";
import { registerSse, broadcastSse } from "./realtime/sse.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: config.corsOrigins });

// ---------- auth helpers ----------
type AuthedRequest = { headers: any; user?: Claims };

function dashboardAuth(request: AuthedRequest): Claims | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyAccessToken(header.slice(7));
  } catch {
    return null;
  }
}

function requireAuth(request: AuthedRequest, reply: any): Claims | null {
  const claims = dashboardAuth(request);
  if (!claims) reply.code(401).send({ error: "unauthorized" });
  return claims;
}

// ---------- health ----------
app.get("/health", async () => ({ ok: true, service: "cloud" }));

// ---------- device sync (token-authenticated) ----------
function requireDeviceToken(request: AuthedRequest): boolean {
  const header = request.headers.authorization;
  return header === `Bearer ${config.deviceIngestToken}`;
}

app.post("/v1/sync/push", async (request, reply) => {
  if (!requireDeviceToken(request)) return reply.code(401).send({ error: "invalid_device_token" });
  const { deviceId, sinceSeq, batch } = request.body as any;
  if (!deviceId || !Array.isArray(batch)) return reply.code(400).send({ error: "invalid_payload" });
  const result = await ingestBatch(deviceId, sinceSeq ?? 0, batch);
  return result;
});

app.get("/v1/sync/pull", async (request, reply) => {
  if (!requireDeviceToken(request)) return reply.code(401).send({ error: "invalid_device_token" });
  const sinceSeq = Number((request.query as any).sinceSeq ?? 0);
  const limit = Math.min(500, Number((request.query as any).limit ?? 200));
  const r = await query(
    `SELECT global_seq, envelope_id, entity, op, payload, at, from_device
     FROM cloud_outbound WHERE global_seq > $1 ORDER BY global_seq LIMIT $2`,
    [sinceSeq, limit]
  );
  const batch = r.rows.map((row) => ({
    id: row.envelope_id,
    entity: row.entity,
    op: row.op,
    localSeq: Number(row.global_seq),
    at: row.at,
    deviceId: row.from_device,
    payload: row.payload,
    schemaVersion: 1,
  }));
  const nextSeq = batch.length > 0 ? Number(batch[batch.length - 1].localSeq) : sinceSeq;
  return { batch, nextSeq, hasMore: batch.length === limit };
});

// ---------- dashboard auth ----------
app.post("/v1/auth/login", async (request, reply) => {
  const { email, password } = request.body as any;
  if (!email || !password) return reply.code(400).send({ error: "invalid_input" });
  const result = await authenticate(email, password);
  if (!result) return reply.code(401).send({ error: "invalid_credentials" });
  return { accessToken: signAccessToken(result.claims), refreshToken: result.refreshToken, user: result.claims };
});

app.post("/v1/auth/refresh", async (request, reply) => {
  const { refreshToken } = request.body as any;
  if (!refreshToken) return reply.code(400).send({ error: "invalid_input" });
  const rotated = await rotateRefresh(refreshToken);
  if (!rotated) return reply.code(401).send({ error: "invalid_refresh" });
  return { accessToken: signAccessToken(rotated.claims), refreshToken: rotated.refreshToken, user: rotated.claims };
});

app.post("/v1/auth/logout", async (request, reply) => {
  const { refreshToken } = request.body as any;
  if (refreshToken) await revokeRefresh(refreshToken);
  return reply.code(204).send();
});

// ---------- dashboard data ----------
app.get("/v1/dashboard/summary", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.todaySummary();
});

app.get("/v1/dashboard/daily", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.dailySales(Number((request.query as any).days ?? 14));
});

app.get("/v1/dashboard/hourly", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.hourlySales();
});

app.get("/v1/dashboard/top-products", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.topProducts(Number((request.query as any).days ?? 30), Number((request.query as any).limit ?? 8));
});

app.get("/v1/dashboard/categories", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.categoryPerformance(Number((request.query as any).days ?? 30));
});

app.get("/v1/dashboard/payments", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.paymentBreakdown(Number((request.query as any).days ?? 30));
});

app.get("/v1/dashboard/cashiers", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.cashierReport(Number((request.query as any).days ?? 30));
});

app.get("/v1/dashboard/low-stock", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.lowStock();
});

app.get("/v1/orders", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.recentOrders(Number((request.query as any).limit ?? 50));
});

app.get("/v1/devices", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return { devices: await reports.deviceStatus(), printers: await reports.printerStatus() };
});

app.get("/v1/audit", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.listAudit(Number((request.query as any).limit ?? 100));
});

app.get("/v1/notifications", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  return reports.listNotifications(Number((request.query as any).limit ?? 50));
});

app.post("/v1/notifications/read-all", async (request, reply) => {
  if (!requireAuth(request, reply)) return;
  await query(`UPDATE cloud_notifications SET read = TRUE`);
  return { ok: true };
});

// ---------- SSE stream ----------
app.get("/v1/stream", async (request, reply) => {
  const claims = requireAuth(request, reply);
  if (!claims) return;
  registerSse(reply, claims.sub);
});

// ---------- boot ----------
await migrate();
await ensureOwnerUser();

await app.listen({ port: config.port, host: config.host });
console.log(`BrewBean cloud API listening on http://${config.host}:${config.port}`);
