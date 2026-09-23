import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getDb, newId, now } from "../db.js";
import { config } from "../config.js";

// ---------- password hashing (scrypt, constant-time compare) ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return test.length === known.length && crypto.timingSafeEqual(test, known);
}

// ---------- JWT ----------

export interface AccessClaims {
  sub: string; // user id
  username: string;
  name: string;
  role: "owner" | "manager" | "cashier";
  deviceId?: string;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, config.jwtSecret) as AccessClaims;
}

export function signRefreshToken(userId: string, deviceId?: string): { token: string; id: string } {
  const raw = crypto.randomBytes(48).toString("hex");
  const id = newId();
  const expires = new Date(Date.now() + config.refreshTokenTtlDays * 86400_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, expires_at, created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(id, userId, sha256(raw), deviceId ?? null, expires, now());
  return { token: raw, id };
}

export function rotateRefreshToken(
  rawToken: string
): { accessToken: string; refreshToken: string } | null {
  const db = getDb();
  const hash = sha256(rawToken);
  const row = db
    .prepare(
      `SELECT rt.*, u.username, u.display_name, u.role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ? AND rt.revoked_at IS NULL AND rt.expires_at > ?`
    )
    .get(hash, now()) as any;
  if (!row) return null;
  db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?").run(now(), row.id);
  const next = signRefreshToken(row.user_id, row.device_id);
  const accessToken = signAccessToken({
    sub: row.user_id,
    username: row.username,
    name: row.display_name,
    role: row.role,
    deviceId: row.device_id ?? undefined,
  });
  return { accessToken, refreshToken: next.token };
}

export function revokeAllRefreshTokens(userId: string): void {
  getDb()
    .prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .run(now(), userId);
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ---------- RBAC ----------

export type Permission =
  | "pos.use"
  | "orders.read"
  | "orders.discount"
  | "orders.cancel"
  | "orders.refund"
  | "orders.reprint"
  | "inventory.read"
  | "inventory.manage"
  | "products.read"
  | "products.manage"
  | "users.manage"
  | "reports.read"
  | "settings.manage"
  | "printers.manage"
  | "audit.read";

const OWNER: Permission[] = ["*"] as any;
const MANAGER: Permission[] = [
  "pos.use",
  "orders.read",
  "orders.discount",
  "orders.cancel",
  "orders.refund",
  "orders.reprint",
  "inventory.read",
  "inventory.manage",
  "products.read",
  "products.manage",
  "users.manage",
  "reports.read",
  "printers.manage",
  "audit.read",
];
const CASHIER: Permission[] = [
  "pos.use",
  "orders.read",
  "orders.reprint",
  "inventory.read",
  "products.read",
];

export function can(role: string, perm: Permission): boolean {
  const set = role === "owner" ? OWNER : role === "manager" ? MANAGER : CASHIER;
  return set.includes("*" as any) || set.includes(perm);
}

export function requirePerm(role: string, perm: Permission): void {
  if (!can(role, perm)) {
    const err = new Error(`Forbidden: missing permission ${perm}`) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
}
