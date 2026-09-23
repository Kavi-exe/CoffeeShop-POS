import type { FastifyInstance } from "fastify";
import { assertPerm, actorOf, type AuthedRequest } from "../plugins/auth-plugin.js";
import {
  createOrder,
  payOrder,
  refundOrder,
  cancelOrder,
  applyOrderDiscount,
  holdOrder,
  resumeOrder,
  loadOrder,
  type CreateOrderInput,
  type PaymentInput,
} from "../services/order-service.js";
import { listOrders } from "../services/report-service.js";
import { printReceiptForOrder, printKitchenTicketsForOrder } from "../services/receipt-service.js";
import { broadcast, broadcastToPos } from "../realtime/hub.js";
import type { OrderSnapshot } from "@brewbean/shared";

function snapshot(order: any): OrderSnapshot {
  return {
    id: order.id,
    orderNo: order.orderNo,
    deviceId: order.deviceId,
    type: order.type,
    status: order.status,
    total: order.totals.total,
    itemCount: order.items.reduce((s: number, i: any) => s + i.qty, 0),
    cashierName: order.cashierName,
    tableName: order.tableName,
    createdAt: order.createdAt,
  };
}

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: (app as any).authHook };

  app.post("/orders", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "pos.use");
    const body = request.body as CreateOrderInput;
    const order = createOrder(
      { ...body, cashier: { id: user.sub, name: user.name }, deviceId: body.deviceId ?? (request.headers["x-device-id"] as string) ?? "unknown" },
      actorOf(request)
    );
    broadcast({ type: "order.created", order: snapshot(order) });
    // prep starts immediately — kitchen/bar tickets print before payment
    printKitchenTicketsForOrder(order);
    return order;
  });

  app.post("/orders/:id/pay", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "pos.use");
    const { id } = request.params as any;
    const payment = request.body as PaymentInput;
    const { order, created } = payOrder(id, payment, { id: user.sub, name: user.name, role: user.role });
    if (created) {
      // print only when this call actually recorded the payment (idempotent
      // retries must not re-print receipts). Kitchen tickets already printed
      // at order creation so prep starts immediately.
      printReceiptForOrder(order);
      broadcast({ type: "order.paid", orderId: order.id, orderNo: order.orderNo, total: order.totals.total, deviceId: order.deviceId });
      if (order.status === "completed") {
        broadcast({ type: "sale.completed", order: snapshot(order) });
      }
    }
    return order;
  });

  app.post("/orders/:id/discount", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "orders.discount");
    const { id } = request.params as any;
    const { discountCents } = request.body as { discountCents: number };
    const order = applyOrderDiscount(id, discountCents, { id: user.sub, name: user.name, role: user.role });
    return order;
  });

  app.post("/orders/:id/refund", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "orders.refund");
    const { id } = request.params as any;
    const { amountCents, reason, restock } = request.body as { amountCents: number; reason: string; restock?: boolean };
    const order = refundOrder(id, amountCents, reason, !!restock, { id: user.sub, name: user.name, role: user.role });
    broadcast({ type: "order.cancelled", orderId: order.id, orderNo: order.orderNo, reason: `refund: ${reason}` });
    return order;
  });

  app.post("/orders/:id/cancel", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "orders.cancel");
    const { id } = request.params as any;
    const { reason } = request.body as { reason: string };
    const order = cancelOrder(id, reason, { id: user.sub, name: user.name, role: user.role });
    broadcast({ type: "order.cancelled", orderId: order.id, orderNo: order.orderNo, reason });
    return order;
  });

  app.post("/orders/:id/hold", read, async (request: AuthedRequest, reply) => {
    assertPerm(request, "pos.use");
    const { id } = request.params as any;
    const { label } = request.body as { label?: string };
    return holdOrder(id, label);
  });

  app.post("/orders/:id/resume", read, async (request: AuthedRequest, reply) => {
    assertPerm(request, "pos.use");
    const { id } = request.params as any;
    return resumeOrder(id);
  });

  app.get("/orders", read, async (request) => {
    const q = request.query as any;
    return listOrders({ status: q.status, limit: Number(q.limit ?? 50), cashierId: q.cashierId });
  });

  app.get("/orders/:id", read, async (request: AuthedRequest, reply) => {
    assertPerm(request, "orders.read");
    const { id } = request.params as any;
    const order = loadOrder(id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    return order;
  });

  app.post("/orders/:id/reprint", read, async (request: AuthedRequest, reply) => {
    const user = assertPerm(request, "orders.reprint");
    const { id } = request.params as any;
    const order = loadOrder(id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    printReceiptForOrder(order, { reprint: true });
    return { ok: true };
  });
}
