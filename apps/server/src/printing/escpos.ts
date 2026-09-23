/**
 * Minimal ESC/POS encoder. Produces raw bytes for thermal printers:
 * initialize, double-strike header handling via plain text markers, feed and
 * full cut. Text is encoded with the printer's codepage (default cp437) with
 * UTF-8 fallback replacing unsupported glyphs.
 */

const ESC = 0x1b;
const GS = 0x1d;

export function escposBytes(text: string, codepage = "cp437"): Buffer {
  const chunks: number[] = [];
  const push = (...b: number[]) => chunks.push(...b);

  // ESC @ — initialize printer
  push(ESC, 0x40);
  // ESC t — codepage 0 (default)
  push(ESC, 0x74, 0x00);

  for (const line of text.split("\n")) {
    const encoded = encodeLine(line, codepage);
    chunks.push(...encoded, 0x0a); // LF
  }

  // feed 4 lines, then GS V 66 0 — full cut
  push(0x0a, 0x0a, 0x0a, 0x0a);
  push(GS, 0x56, 0x42, 0x00);
  return Buffer.from(chunks);
}

function encodeLine(line: string, codepage: string): number[] {
  try {
    return Array.from(Buffer.from(line, codepage as BufferEncoding));
  } catch {
    return Array.from(Buffer.from(line, "utf8"));
  }
}

/** Render a header line in "double width" via ESC ! 0x30 around the text. */
export function emphasized(text: string): string {
  return `\x1b!0x30${text}\x1b!0x00`;
}

// ----------------------------------------------------------------------------
// Ticket templates (plain text; escposBytes handles the byte stream)
// ----------------------------------------------------------------------------

export interface ReceiptLine {
  name: string;
  qty: number;
  modifiers: string[];
  lineTotal: string; // preformatted
}

export interface ReceiptData {
  cafeName: string;
  address?: string;
  phone?: string;
  orderNo: number;
  orderType: string;
  tableName?: string | null;
  cashierName: string;
  deviceId: string;
  at: string;
  lines: ReceiptLine[];
  subtotal: string;
  orderDiscount?: string;
  tax?: string;
  serviceCharge?: string;
  deliveryFee?: string;
  total: string;
  payments: Array<{ method: string; amount: string }>;
  change?: string;
  footer: string;
  reprint?: boolean;
}

export function renderReceipt(d: ReceiptData): string {
  const width = 40; // 80mm ≈ 42 chars @ 12x24; keep 40 for safety
  const center = (s: string) => s.length >= width ? s : " ".repeat(Math.max(0, Math.floor((width - s.length) / 2))) + s;
  const row = (left: string, right: string) => {
    const space = Math.max(1, width - left.length - right.length);
    return left + " ".repeat(space) + right;
  };

  const out: string[] = [];
  out.push(center(d.cafeName.toUpperCase()));
  if (d.address) out.push(center(d.address));
  if (d.phone) out.push(center(d.phone));
  out.push("-".repeat(width));
  out.push(row(`Order #${d.orderNo}`, d.orderType + (d.tableName ? ` · ${d.tableName}` : "")));
  out.push(row(d.at, `${d.cashierName} @ ${d.deviceId}`));
  if (d.reprint) out.push(center("*** REPRINT ***"));
  out.push("-".repeat(width));

  for (const l of d.lines) {
    out.push(row(`${l.qty} x ${l.name}`, l.lineTotal));
    for (const m of l.modifiers) out.push(`    + ${m}`);
  }

  out.push("-".repeat(width));
  out.push(row("Subtotal", d.subtotal));
  if (d.orderDiscount && d.orderDiscount !== "0.00") out.push(row("Discount", `-${d.orderDiscount}`));
  if (d.serviceCharge && d.serviceCharge !== "0.00") out.push(row("Service charge", d.serviceCharge));
  if (d.tax && d.tax !== "0.00") out.push(row("Tax", d.tax));
  if (d.deliveryFee && d.deliveryFee !== "0.00") out.push(row("Delivery", d.deliveryFee));
  out.push(row("TOTAL", d.total));
  out.push("-".repeat(width));
  for (const p of d.payments) out.push(row(p.method, p.amount));
  if (d.change && d.change !== "0.00") out.push(row("Change", d.change));
  out.push("");
  out.push(center(d.footer));
  out.push("");
  return out.join("\n");
}

export interface KitchenTicketData {
  orderNo: number;
  orderType: string;
  tableName?: string | null;
  at: string;
  station: "BAR" | "KITCHEN";
  lines: Array<{ qty: number; name: string; modifiers: string[]; note?: string }>;
  customerNote?: string;
}

export function renderKitchenTicket(d: KitchenTicketData): string {
  const out: string[] = [];
  out.push(`*** ${d.station} ***`);
  out.push(`Order #${d.orderNo}  ${d.orderType}${d.tableName ? ` · ${d.tableName}` : ""}`);
  out.push(d.at);
  out.push("-".repeat(32));
  for (const l of d.lines) {
    out.push(`${l.qty} x ${l.name}`);
    for (const m of l.modifiers) out.push(`   + ${m}`);
    if (l.note) out.push(`   NOTE: ${l.note}`);
  }
  if (d.customerNote) {
    out.push("-".repeat(32));
    out.push(`CUSTOMER: ${d.customerNote}`);
  }
  out.push("-".repeat(32));
  out.push("");
  return out.join("\n");
}
