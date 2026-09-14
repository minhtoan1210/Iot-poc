import type { SSEEvent } from "@/types/device";

// Store connected SSE clients on globalThis so the registry survives
// Next.js dev hot-reload (otherwise clients would be orphaned on reload).
type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
};

const globalForSSE = globalThis as typeof globalThis & {
  __sseClients?: Map<string, SSEClient>;
};

const clients: Map<string, SSEClient> =
  globalForSSE.__sseClients ?? new Map();

if (process.env.NODE_ENV !== "production") {
  globalForSSE.__sseClients = clients;
}

export function addClient(
  id: string,
  controller: ReadableStreamDefaultController
): void {
  clients.set(id, { id, controller });
  console.log(`[SSE] Client connected: ${id}. Total: ${clients.size}`);
}

export function removeClient(id: string): void {
  clients.delete(id);
  console.log(`[SSE] Client disconnected: ${id}. Total: ${clients.size}`);
}

export function broadcastEvent(event: SSEEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const deadClients: string[] = [];

  clients.forEach((client) => {
    try {
      client.controller.enqueue(new TextEncoder().encode(data));
    } catch {
      deadClients.push(client.id);
    }
  });

  // Clean up dead clients
  deadClients.forEach((id) => removeClient(id));
}
