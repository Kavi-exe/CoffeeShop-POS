/**
 * BrewBean Café POS — shared TypeScript contracts.
 * Used verbatim by the local server, cloud API, POS tablets and admin dashboard.
 */

// ---------- catalog ----------
export * from "./catalog.js";
// ---------- orders / payments ----------
export * from "./orders.js";
// ---------- inventory ----------
export * from "./inventory.js";
// ---------- sync protocol ----------
export * from "./sync.js";
// ---------- realtime events ----------
export * from "./events.js";
// ---------- settings, printers, shifts, audit, money ----------
export * from "./platform.js";
