import type { FastifyInstance } from "fastify";
import { getDb, now } from "../db.js";
import { assertPerm, type AuthedRequest } from "../plugins/auth-plugin.js";
import {
  openShift,
  closeShift,
  getOpenShiftForUser,
  getShift,
  computeShiftMetrics,
  listShifts,
} from "../services/shift-service.js";

export async function shiftRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: (app as any).authHook };

  app.get("/shifts/open", read, async (request: AuthedRequest) => {
    const user = assertPerm(request, "pos.use");
    return getOpenShiftForUser(user.sub) ?? null;
  });

  app.post("/shifts/open", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "pos.use");
    const { openingCashCents } = request.body as { openingCashCents: number };
    const deviceId = (request.headers["x-device-id"] as string) ?? "unknown";
    return openShift({ id: user.sub, name: user.name }, deviceId, openingCashCents, request.user!);
  });

  app.post("/shifts/:id/close", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "pos.use");
    const { id } = request.params as any;
    const { countedCashCents, notes } = request.body as { countedCashCents: number; notes?: string };
    return closeShift(id, countedCashCents, notes, request.user!);
  });

  app.get("/shifts/:id/metrics", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "pos.use");
    const { id } = request.params as any;
    return computeShiftMetrics(id);
  });

  app.get("/shifts", read, async () => {
    return listShifts();
  });
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/devices/heartbeat", async (request, reply) => {
    const { deviceId, name, appVersion } = request.body as any;
    const db = getDb();
    db.prepare(
      `INSERT INTO devices (id, name, kind, app_version, last_seen_at, online, registered_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, app_version=excluded.app_version,
         last_seen_at=excluded.last_seen_at, online=1`
    ).run(deviceId, name ?? deviceId, "pos", appVersion ?? null, now(), now());
    return { ok: true };
  });

  app.get("/devices", { preHandler: (app as any).authHook }, async () => {
    const rows = getDb().prepare(`SELECT * FROM devices ORDER BY kind, id`).all() as any[];
    // mark offline if no heartbeat for 2 minutes
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    // shape mirrors the cloud API: { devices, printers }
    const { listPrinters } = await import("../services/printer-service.js");
    return {
      devices: rows.map((d) => ({
        id: d.id, name: d.name, kind: d.kind, appVersion: d.app_version,
        lastSeenAt: d.last_seen_at, reachable: d.last_seen_at > cutoff, online: d.last_seen_at > cutoff,
      })),
      printers: listPrinters().map((p) => ({
        id: p.id, name: p.name, kind: p.kind, status: p.status, lastSeenAt: p.lastSeenAt,
      })),
    };
  });
}
