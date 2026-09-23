import type { CafeSettings } from "@brewbean/shared";
import { getDb, now } from "../db.js";

export const DEFAULT_SETTINGS: CafeSettings = {
  name: "BrewBean Café",
  address: "42 Palm Avenue, Colombo 03",
  phone: "+94 11 234 5678",
  currency: "LKR",
  currencySymbol: "Rs",
  taxPercent: 0,
  serviceChargePercent: 10,
  receiptFooter: "Thank you for visiting BrewBean Café! ☕",
};

export function getSettingJson<T>(key: string, fallback: T): T {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSettingJson(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), now());
}

export function getCafeSettings(): CafeSettings {
  return { ...DEFAULT_SETTINGS, ...getSettingJson<Partial<CafeSettings>>("cafe", {}) };
}
