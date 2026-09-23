import type { PrinterConfig } from "@brewbean/shared";
import { getDb, newId, now } from "../db.js";
import { broadcast } from "../realtime/hub.js";
import { audit, type AuditActor } from "./audit.js";

export function listPrinters(): PrinterConfig[] {
  return (getDb().prepare(`SELECT * FROM printers ORDER BY kind, name`).all() as any[]).map(mapPrinter);
}

export function getPrinter(id: string): PrinterConfig | undefined {
  const row = getDb().prepare(`SELECT * FROM printers WHERE id = ?`).get(id) as any;
  return row ? mapPrinter(row) : undefined;
}

function mapPrinter(r: any): PrinterConfig {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    connection: r.connection,
    address: r.address ?? undefined,
    usbDevice: r.usb_device ?? undefined,
    fileSinkDir: r.file_sink_dir ?? undefined,
    codepage: r.codepage,
    widthDots: r.width_dots,
    categories: JSON.parse(r.categories_json ?? "[]"),
    printModifiers: !!r.print_modifiers,
    printLogo: !!r.print_logo,
    copies: r.copies,
    enabled: !!r.enabled,
    status: r.status,
    lastSeenAt: r.last_seen_at ?? undefined,
    updatedAt: r.updated_at,
  };
}

export function upsertPrinter(p: PrinterConfig, actor: AuditActor): PrinterConfig {
  const db = getDb();
  const at = now();
  db.prepare(
    `INSERT INTO printers (id, name, kind, connection, address, usb_device, file_sink_dir, codepage,
      width_dots, categories_json, print_modifiers, print_logo, copies, enabled, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, kind=excluded.kind, connection=excluded.connection, address=excluded.address,
      usb_device=excluded.usb_device, file_sink_dir=excluded.file_sink_dir, codepage=excluded.codepage,
      width_dots=excluded.width_dots, categories_json=excluded.categories_json,
      print_modifiers=excluded.print_modifiers, print_logo=excluded.print_logo, copies=excluded.copies,
      enabled=excluded.enabled, status=excluded.status, updated_at=excluded.updated_at`
  ).run(
    p.id ?? newId(),
    p.name,
    p.kind,
    p.connection,
    physicalAddress(p) ?? null,
    p.usbDevice ?? null,
    p.fileSinkDir ?? null,
    p.codepage,
    p.widthDots,
    JSON.stringify(p.categories),
    p.printModifiers ? 1 : 0,
    p.printLogo ? 1 : 0,
    p.copies,
    p.enabled ? 1 : 0,
    "unknown",
    at
  );
  audit(actor, "printer.update", "printers", p.id, `Printer "${p.name}" saved (${p.connection}, categories: ${p.categories.join(", ") || "none"})`);
  return getPrinter(p.id)!;
}

function physicalAddress(p: PrinterConfig): string | undefined {
  if (p.connection === "network") return p.address;
  if (p.connection === "usb") return p.usbDevice;
  return undefined;
}

export function setPrinterStatus(id: string, status: PrinterConfig["status"], detail?: string): void {
  const db = getDb();
  db.prepare(`UPDATE printers SET status = ?, last_seen_at = ? WHERE id = ?`).run(
    status,
    now(),
    id
  );
  const p = getPrinter(id);
  if (p) {
    broadcast({
      type: "printer.status",
      printerId: id,
      name: p.name,
      status: status === "error" ? "error" : status,
      detail,
    } as any);
  }
}

/**
 * Resolve printer assignment for a product at order time.
 * Priority: category override on printer config → category default → fallback.
 */
export function resolvePrinterForCategory(categoryId: string): string | null {
  const db = getDb();
  const cat = db.prepare(`SELECT printer_id FROM categories WHERE id = ?`).get(categoryId) as any;
  if (cat?.printer_id) return cat.printer_id;

  const printers = listPrinters().filter((p) => p.enabled);
  const byCategory = printers.find((p) => p.categories.includes(categoryId));
  if (byCategory) return byCategory.id;

  const kitchen = printers.find((p) => p.kind === "kitchen");
  return kitchen?.id ?? printers[0]?.id ?? null;
}

export function testPrint(printerId: string, actor: AuditActor): { ok: boolean; detail: string } {
  const printer = getPrinter(printerId);
  if (!printer) return { ok: false, detail: "Printer not found" };
  const { enqueuePrintJob } = require("./print-worker.js");
  enqueuePrintJob({
    printerId,
    orderId: null,
    orderNo: null,
    kind: "receipt",
    text: renderTestPage(printer),
  });
  audit(actor, "printer.test", "printers", printerId, `Test page sent to ${printer.name}`);
  return { ok: true, detail: "Test page queued" };
}

function renderTestPage(printer: PrinterConfig): string {
  const lines = [
    "================================",
    "  BREWBEAN CAFE - PRINTER TEST  ",
    "================================",
    `Printer : ${printer.name}`,
    `Kind    : ${printer.kind}`,
    `Conn    : ${printer.connection}${printer.address ? " " + printer.address : ""}`,
    `Width   : ${printer.widthDots} dots`,
    `Time    : ${new Date().toISOString()}`,
    "--------------------------------",
    "If you can read this page, the",
    "printer is configured correctly.",
    "================================",
  ];
  return lines.join("\n");
}
