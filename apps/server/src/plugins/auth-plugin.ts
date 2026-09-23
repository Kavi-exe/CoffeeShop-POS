import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken, can, type Permission, type AccessClaims } from "../services/auth.js";
import { audit } from "../services/audit.js";

export interface AuthedRequest extends FastifyRequest {
  user?: AccessClaims;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AccessClaims;
  }
}

export async function authHook(request: AuthedRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "unauthorized", message: "Missing bearer token" });
    return;
  }
  try {
    const claims = verifyAccessToken(header.slice(7));
    request.user = claims;
  } catch {
    reply.code(401).send({ error: "unauthorized", message: "Invalid or expired token" });
  }
}

/** Factory used inside handlers: throws a 403-shaped error when missing. */
export function assertPerm(request: AuthedRequest, perm: Permission): AccessClaims {
  const user = request.user;
  if (!user) {
    const err = new Error("Unauthorized") as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  if (!can(user.role, perm)) {
    const err = new Error(`Forbidden: ${perm} required`) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  return user;
}

export function actorOf(request: AuthedRequest) {
  const u = request.user;
  return {
    id: u?.sub,
    name: u?.name,
    role: u?.role,
    deviceId: (request.headers["x-device-id"] as string) || u?.deviceId,
  };
}

export { audit };
