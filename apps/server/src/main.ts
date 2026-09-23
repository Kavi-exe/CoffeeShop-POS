import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { initDb, getDb } from "./db.js";
import { seedIfEmpty } from "./services/seed.js";
import { authHook } from "./plugins/auth-plugin.js";
import { authRoutes } from "./routes/auth-routes.js";
import { catalogRoutes } from "./routes/catalog-routes.js";
import { orderRoutes } from "./routes/order-routes.js";
import { inventoryRoutes } from "./routes/inventory-routes.js";
import { shiftRoutes, deviceRoutes } from "./routes/shift-device-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { dashboardCompatRoutes } from "./routes/dashboard-compat-routes.js";
import { registerClient } from "./realtime/hub.js";
import { startPrintWorker } from "./services/print-worker.js";
import { startSyncEngine } from "./services/sync-engine.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cors, { origin: config.corsOrigins });

app.decorateRequest("user", undefined);

// attach auth hook for routes that declare preHandler
(app as any).authHook = authHook;

// health endpoint (unauthenticated, LAN-safe)
app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

await app.register(authRoutes, { prefix: "/v1" });
await app.register(catalogRoutes, { prefix: "/v1" });
await app.register(orderRoutes, { prefix: "/v1" });
await app.register(inventoryRoutes, { prefix: "/v1" });
await app.register(shiftRoutes, { prefix: "/v1" });
await app.register(deviceRoutes, { prefix: "/v1" });
await app.register(adminRoutes, { prefix: "/v1" });
await app.register(dashboardCompatRoutes, { prefix: "/v1" });

// ---------- realtime ----------
await app.register(websocket, { options: { maxPayload: 1048576 } });
app.get("/ws", { websocket: true }, (socket, request) => {
  const kind = ((request.query as any)?.kind as string) === "admin" ? "admin" : "pos";
  registerClient(socket, kind);
  socket.send(JSON.stringify({ type: "hello", serverTime: new Date().toISOString() }));
  socket.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") socket.send(JSON.stringify({ type: "hello", serverTime: new Date().toISOString() }));
      if (msg.type === "device.heartbeat") {
        getDb()
          .prepare(
            `INSERT INTO devices (id, name, kind, app_version, last_seen_at, online, registered_at)
             VALUES (?,?,?,?,?,1,?)
             ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, online=1`
          )
          .run(msg.deviceId, msg.name ?? msg.deviceId, "pos", msg.appVersion ?? null, new Date().toISOString(), new Date().toISOString());
      }
    } catch {
      // ignore malformed frames
    }
  });
});

// ---------- boot ----------
initDb();
seedIfEmpty();

startPrintWorker();
startSyncEngine();

// serve built POS app if present (single-device kiosk deployment)
const posDist = path.resolve(process.env.POS_DIST_DIR ?? "../pos/dist");
if (fs.existsSync(posDist)) {
  await app.register(fastifyStatic, {
    root: path.resolve(posDist),
    prefix: "/pos/",
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/pos/")) {
      return reply.sendFile("index.html", path.resolve(posDist));
    }
    reply.code(404).send({ error: "not_found" });
  });
}

await app.listen({ port: config.port, host: config.host });
console.log(`BrewBean local server listening on http://${config.host}:${config.port}`);
