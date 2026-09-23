import type { FastifyReply } from "fastify";

interface SseClient {
  reply: FastifyReply;
  userId: string;
}

const clients = new Set<SseClient>();

export function registerSse(reply: FastifyReply, userId: string): void {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);
  const client: SseClient = { reply, userId };
  clients.add(client);
  const ping = setInterval(() => {
    try {
      reply.raw.write(`: ping\n\n`);
    } catch {
      cleanup();
    }
  }, 25000);
  function cleanup() {
    clearInterval(ping);
    clients.delete(client);
  }
  reply.raw.on("close", cleanup);
  reply.raw.on("error", cleanup);
}

export function broadcastSse(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of [...clients]) {
    try {
      c.reply.raw.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}
