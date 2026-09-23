import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { query } from "../db.js";

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

export interface Claims {
  sub: string;
  email: string;
  name: string;
  role: "owner" | "manager" | "viewer";
}

export function signAccessToken(claims: Claims): string {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.accessTokenTtl } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): Claims {
  return jwt.verify(token, config.jwtSecret) as Claims;
}

export async function ensureOwnerUser(): Promise<void> {
  const existing = await query(`SELECT id FROM dashboard_users WHERE email = $1`, [config.ownerEmail]);
  if (existing.rowCount === 0) {
    await query(
      `INSERT INTO dashboard_users (id, email, name, role, password_hash) VALUES ($1,$2,$3,'owner',$4)`,
      [crypto.randomUUID(), config.ownerEmail, config.ownerName, hashPassword(config.ownerPassword)]
    );
    console.log(`[cloud] owner account created: ${config.ownerEmail}`);
  }
}

export async function authenticate(email: string, password: string): Promise<{ claims: Claims; refreshToken: string } | null> {
  const r = await query(`SELECT * FROM dashboard_users WHERE email = $1`, [email.toLowerCase().trim()]);
  const user = r.rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const claims: Claims = { sub: user.id, email: user.email, name: user.name, role: user.role };
  const refreshToken = crypto.randomBytes(48).toString("hex");
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + interval '14 days')`,
    [crypto.randomUUID(), user.id, crypto.createHash("sha256").update(refreshToken).digest("hex")]
  );
  return { claims, refreshToken };
}

export async function rotateRefresh(raw: string): Promise<{ claims: Claims; refreshToken: string } | null> {
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const r = await query(
    `SELECT rt.id rtid, u.* FROM refresh_tokens rt JOIN dashboard_users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()`,
    [hash]
  );
  const row = r.rows[0];
  if (!row) return null;
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.rtid]);
  const claims: Claims = { sub: row.id, email: row.email, name: row.name, role: row.role };
  const refreshToken = crypto.randomBytes(48).toString("hex");
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + interval '14 days')`,
    [crypto.randomUUID(), row.id, crypto.createHash("sha256").update(refreshToken).digest("hex")]
  );
  return { claims, refreshToken };
}

export async function revokeRefresh(raw: string): Promise<void> {
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hash]);
}
