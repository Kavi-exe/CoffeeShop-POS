import type { OrderStatus, PaymentStatus } from "./orders.js";

export interface CafeSettings {
  name: string;
  legalName?: string;
  address?: string;
  phone?: string;
  currency: string; // "LKR"
  currencySymbol: string; // "Rs"
  taxPercent: number; // 0 = disabled
  serviceChargePercent: number; // 0 = disabled
  receiptFooter: string;
  logoDataUrl?: string;
}

export interface PrinterConfig {
  id: string;
  name: string;
  kind: "receipt" | "kitchen";
  connection: "network" | "usb" | "bluetooth" | "file";
  address?: string; // ip:port for network printers
  usbDevice?: string; // e.g. /dev/usb/lp0
  fileSinkDir?: string;
  codepage: string;
  widthDots: number; // 80mm = 576, 58mm = 384
  categories: string[]; // category ids routed to this printer
  printModifiers: boolean;
  printLogo: boolean;
  copies: number;
  enabled: boolean;
  status: "online" | "offline" | "error" | "unknown";
  lastSeenAt?: string;
  updatedAt: string;
}

export interface DeviceInfo {
  id: string; // "pos-01"
  name: string;
  kind: "pos" | "server" | "admin";
  appVersion: string;
  lastSeenAt: string;
  online: boolean;
  registeredAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  userId?: string;
  userName?: string;
  role?: string;
  deviceId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  detail: string;
  meta?: Record<string, unknown>;
  source: "local" | "cloud";
}

export interface ShiftSummary {
  openingCash: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  cashRefunds: number;
  cashPaidOuts: number;
  expectedCash: number;
  countedCash?: number;
  difference?: number;
}

export function formatMoney(cents: number, symbol = "LKR"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${symbol} ${whole.toLocaleString("en-US")}.${frac}`;
}

export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
