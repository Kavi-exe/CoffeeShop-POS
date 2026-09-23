import type { Order } from "@brewbean/shared";
import { getDb } from "../db.js";
import { formatMoney } from "@brewbean/shared";
import { renderReceipt, renderKitchenTicket } from "../printing/escpos.js";
import { enqueuePrintJob } from "./print-worker.js";
import { resolvePrinterForCategory, getPrinter } from "./printer-service.js";
import { getCafeSettings } from "./settings-service.js";

const money = (c: number) => formatMoney(c, "Rs");

export function printReceiptForOrder(order: Order, opts: { reprint?: boolean } = {}): void {
  const db = getDb();
  const settings = getCafeSettings();

  const receiptPrinterId =
    (db.prepare(`SELECT value FROM settings WHERE key='receipt_printer_id'`).get() as any)?.value ??
    (getDb().prepare(`SELECT id FROM printers WHERE kind='receipt' LIMIT 1`).get() as any)?.id;

  if (!receiptPrinterId) {
    // No receipt printer configured: skip silently; queue keeps history only
    return;
  }

  const text = renderReceipt({
    cafeName: settings.name,
    address: settings.address,
    phone: settings.phone,
    orderNo: order.orderNo,
    orderType: order.type.replace("_", "-").toUpperCase(),
    tableName: order.tableName,
    cashierName: order.cashierName,
    deviceId: order.deviceId,
    at: new Date(order.createdAt).toLocaleString("en-GB"),
    lines: order.items.map((i) => ({
      name: i.productName,
      qty: i.qty,
      modifiers: i.modifiers.map((m) => m.name),
      lineTotal: money(i.lineTotal),
    })),
    subtotal: money(order.totals.subtotal),
    orderDiscount: money(order.totals.orderDiscount),
    tax: money(order.totals.tax),
    serviceCharge: money(order.totals.serviceCharge),
    deliveryFee: money(order.totals.deliveryFee),
    total: money(order.totals.total),
    payments: order.payments.map((p) => ({ method: p.method.replace("_", " "), amount: money(p.amount) })),
    change: money(order.payments.reduce((s, p) => s + (p.changeGiven ?? 0), 0)),
    footer: settings.receiptFooter,
    reprint: opts.reprint,
  });

  enqueuePrintJob({ printerId: receiptPrinterId, orderId: order.id, orderNo: order.orderNo, kind: "receipt", text });
}

/** Split the order across bar/kitchen printers by station of each item. */
export function printKitchenTicketsForOrder(order: Order): void {
  const stations: Array<"bar" | "kitchen"> = ["bar", "kitchen"];
  for (const station of stations) {
    const items = order.items.filter((i) => i.station === station);
    if (items.length === 0) continue;

    const categoryId = (
      getDb()
        .prepare(`SELECT category_id FROM products WHERE id = ?`)
        .get(items[0]!.productId) as any
    )?.category_id;

    const printerId = resolvePrinterForCategory(categoryId) ?? fallbackFor(station);
    if (!printerId) continue;
    const printer = getPrinter(printerId);
    if (!printer || !printer.enabled) continue;

    const text = renderKitchenTicket({
      orderNo: order.orderNo,
      orderType: order.type.replace("_", "-").toUpperCase(),
      tableName: order.tableName,
      at: new Date().toLocaleTimeString("en-GB"),
      station: station === "bar" ? "BAR" : "KITCHEN",
      lines: items.map((i) => ({
        qty: i.qty,
        name: i.productName,
        modifiers: printer.printModifiers ? i.modifiers.map((m) => m.name) : [],
        note: i.note,
      })),
      customerNote: order.customerNote,
    });

    enqueuePrintJob({ printerId, orderId: order.id, orderNo: order.orderNo, kind: "kitchen", text });
  }
}

function fallbackFor(station: "bar" | "kitchen"): string | null {
  const kind = station === "bar" ? "bar" : "kitchen";
  const row = getDb().prepare(`SELECT id FROM printers WHERE kind = ? LIMIT 1`).get(kind) as any;
  return row?.id ?? null;
}
