import type { FastifyInstance } from "fastify";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
} from "../services/auth.js";
import { audit } from "../services/audit.js";
import { getDb } from "../db.js";
import { authHook } from "../plugins/auth-plugin.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, string>;
    // admin dashboard logs in by email; accept `email` as an alias for username
    const username = body.username ?? body.email;
    const { password, deviceId } = body;
    if (!username || !password) {
      return reply.code(400).send({ error: "invalid_input", message: "username and password required" });
    }
    const user = getDb().prepare(`SELECT * FROM users WHERE username = ? AND active = 1`).get(username) as any;
    if (!user || !verifyPassword(password, user.pin_hash)) {
      audit({ name: username }, "login_failed", "users", undefined, `Failed login attempt for "${username}"`);
      return reply.code(401).send({ error: "invalid_credentials", message: "Invalid username or password" });
    }

    const claims = {
      sub: user.id,
      username: user.username,
      name: user.display_name,
      role: user.role,
      deviceId: deviceId || undefined,
    };
    const accessToken = signAccessToken(claims);
    const refresh = signRefreshToken(user.id, deviceId);

    audit(
      { id: user.id, name: user.display_name, role: user.role, deviceId },
      "login",
      "users",
      user.id,
      `${user.display_name} logged in${deviceId ? ` on ${deviceId}` : ""}`
    );

    return {
      accessToken,
      refreshToken: refresh.token,
      user: { id: user.id, username: user.username, name: user.display_name, role: user.role },
    };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as Record<string, string>;
    if (!refreshToken) return reply.code(400).send({ error: "invalid_input" });
    const rotated = rotateRefreshToken(refreshToken);
    if (!rotated) return reply.code(401).send({ error: "invalid_refresh" });
    return rotated;
  });

  app.post("/auth/logout", async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as Record<string, string>;
    if (refreshToken) {
      getDb().prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?`).run(
        new Date().toISOString(),
        (await import("node:crypto")).createHash("sha256").update(refreshToken).digest("hex")
      );
    }
    if (request.user) {
      audit(request.user, "logout", "users", request.user.sub, `${request.user.name} logged out`);
    }
    return reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: authHook }, async (request) => {
    const u = request.user!;
    const row = getDb().prepare(`SELECT id, username, display_name, role FROM users WHERE id = ?`).get(u.sub) as any;
    return { id: row.id, username: row.username, name: row.display_name, role: row.role };
  });
}
