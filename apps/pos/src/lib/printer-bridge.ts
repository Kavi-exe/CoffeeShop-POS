import type { Order } from "@brewbean/shared";
import { formatMoney } from "@brewbean/shared";

/**
 * Browser-side receipt rendering. Primary receipts print on the server's
 * thermal printers; this fallback produces a printable window for offline
 * receipts or USB-connected tablet printers.
 */
export function receiptText(order: Order, cafe: { name: string; address?: string; phone?: string; footer: string }): string {
  const money = (c: number) => formatMoney(c, "Rs");
  const width = 40;
  const row = (l: string, r: string) => l + " ".repeat(Math.max(1, width - l.length - r.length)) + r;
  const center = (s: string) => " ".repeat(Math.max(0, Math.floor((width - s.length) / 2))) + s;

  const lines: string[] = [];
  lines.push(center(cafe.name.toUpperCase()));
  if (cafe.address) lines.push(center(cafe.address));
  if (cafe.phone) lines.push(center(cafe.phone));
  lines.push("-".repeat(width));
  lines.push(row(`Order #${order.orderNo}`, order.type.replace("_", "-")));
  lines.push(row(new Date(order.createdAt).toLocaleString("en-GB"), order.cashierName));
  lines.push("-".repeat(width));
  for (const item of order.items) {
    lines.push(row(`${item.qty} x ${item.productName}`, money(item.lineTotal)));
    for (const m of item.modifiers) lines.push(`    + ${m.name}`);
  }
  lines.push("-".repeat(width));
  lines.push(row("Subtotal", money(order.totals.subtotal)));
  if (order.totals.orderDiscount) lines.push(row("Discount", `-${money(order.totals.orderDiscount)}`));
  if (order.totals.serviceCharge) lines.push(row("Service", money(order.totals.serviceCharge)));
  if (order.totals.tax) lines.push(row("Tax", money(order.totals.tax)));
  lines.push(row("TOTAL", money(order.totals.total)));
  for (const p of order.payments) lines.push(row(p.method.replace("_", " "), money(p.amount)));
  const change = order.payments.reduce((s, p) => s + (p.changeGiven ?? 0), 0);
  if (change > 0) lines.push(row("Change", money(change)));
  lines.push("");
  lines.push(center(cafe.footer));
  return lines.join("\n");
}

export function printFallback(text: string): void {
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) return;
  win.document.write(
    `<pre style="font-family:'Courier New',monospace;font-size:12px;margin:8px;">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre><script>window.onload=()=>window.print()<\/script>`
  );
  win.document.close();
}
