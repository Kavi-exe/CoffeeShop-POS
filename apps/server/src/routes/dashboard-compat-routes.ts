import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { assertPerm, type AuthedRequest } from "../plugins/auth-plugin.js";
import {
  todaySummary,
  dailySales,
  hourlySales,
  topProducts,
  categoryPerformance,
  paymentBreakdown,
  cashierReport,
  lowStockItems,
} from "../services/report-service.js";
import { listPrinters } from "../services/printer-service.js";
import { refundOrder } from "../services/order-service.js";
import { subscribeSse } from "../realtime/hub.js";

/**
 * Compatibility routes mirroring the cloud API surface, so the admin
 * dashboard works against the LOCAL server too (single-café mode, no
 * Postgres/cloud required). Cloud deployments serve the same shapes from
 * apps/cloud; these handlers read directly from the local SQLite mirror.
 */
export async function dashboardCompatRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: (app as any).authHook };

  app.get("/dashboard/summary", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return todaySummary();
  });

  app.get("/dashboard/daily", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return dailySales(Number((request.query as any)?.days ?? 14));
  });

  app.get("/dashboard/hourly", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return hourlySales((request.query as any)?.date);
  });

  app.get("/dashboard/top-products", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return topProducts(Number((request.query as any)?.days ?? 7), Number((request.query as any)?.limit ?? 5));
  });

  app.get("/dashboard/categories", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return categoryPerformance(Number((request.query as any)?.days ?? 30));
  });

  app.get("/dashboard/payments", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return paymentBreakdown(Number((request.query as any)?.days ?? 30));
  });

  app.get("/dashboard/cashiers", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    return cashierReport(Number((request.query as any)?.days ?? 30));
  });

  app.get("/dashboard/low-stock", read, async (request: AuthedRequest) => {
    assertPerm(request, "inventory.read");
    return lowStockItems();
  });

  // Dashboard expects { devices, printers } — local /devices returns a bare array.
  app.get("/dashboard/devices", read, async (request: AuthedRequest) => {
    assertPerm(request, "reports.read");
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM devices ORDER BY kind, id`).all() as any[];
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    return {
      devices: rows.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        reachable: d.last_seen_at > cutoff,
        lastSeenAt: d.last_seen_at,
      })),
      printers: listPrinters().map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        status: p.status,
      })),
    };
  });

  // Owner-initiated refund intent (cash actually moves at the café).
  app.post("/orders/:id/refund-remote", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "orders.refund");
    const { id } = request.params as any;
    const { amountCents, reason } = request.body as { amountCents: number; reason?: string };
    const order = refundOrder(
      id,
      amountCents,
      reason ?? "remote refund",
      false,
      { id: user.sub, name: user.name, role: user.role }
    );
    return { ok: true, orderNo: order.orderNo, status: order.status };
  });

  // SSE live stream (admin dashboard replaces its /v1/stream connection).
  app.get("/stream", { preHandler: (app as any).authHook }, async (request: AuthedRequest, reply) => {
    assertPerm(request, "reports.read");
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(`event: ping\ndata: {"ok":true}\n\n`);

    const unsubscribe = subscribeSse((event) => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        unsubscribe();
      }
    });

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`);
      } catch {
        /* cleaned up below */
      }
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
