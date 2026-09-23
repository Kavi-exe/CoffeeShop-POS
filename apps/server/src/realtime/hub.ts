import type { RealtimeEvent } from "@brewbean/shared";
import type { WebSocket } from "ws";

type Client = { socket: WebSocket; kind: "pos" | "admin" | "unknown" };

const clients = new Set<Client>();

/** Server-Sent-Events subscribers (admin dashboard live view). */
const sseListeners = new Set<(event: RealtimeEvent) => void>();

export function subscribeSse(fn: (event: RealtimeEvent) => void): () => void {
  sseListeners.add(fn);
  return () => sseListeners.delete(fn);
}

export function registerClient(socket: WebSocket, kind: Client["kind"]): () => void {
  const client: Client = { socket, kind };
  clients.add(client);
  socket.on("close", () => clients.delete(client));
  socket.on("error", () => clients.delete(client));
  return () => clients.delete(client);
}

export function broadcast(event: RealtimeEvent): void {
  const payload = JSON.stringify(event);
  for (const c of clients) {
    if (c.socket.readyState === 1) {
      try {
        c.socket.send(payload);
      } catch {
        clients.delete(c);
      }
    }
  }
  for (const fn of sseListeners) {
    try {
      fn(event);
    } catch {
      sseListeners.delete(fn);
    }
  }
}

/** Send only to POS clients (e.g. availability updates). */
export function broadcastToPos(event: RealtimeEvent): void {
  const payload = JSON.stringify(event);
  for (const c of clients) {
    if (c.kind === "pos" && c.socket.readyState === 1) {
      try {
        c.socket.send(payload);
      } catch {
        clients.delete(c);
      }
    }
  }
}
