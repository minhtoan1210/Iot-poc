import { v4 as uuidv4 } from "uuid";
import { addClient, removeClient } from "@/lib/sse-manager";
import { initializeMQTTHandlers } from "@/lib/mqtt-handler";

// Ensure MQTT handlers are initialized
initializeMQTTHandlers();

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = uuidv4();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`)
      );

      // Register client
      addClient(clientId, controller);

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup when client disconnects
      // Note: The cancel callback is invoked when the client disconnects
    },
    cancel() {
      removeClient(clientId);
      console.log(`[SSE] Stream cancelled for client: ${clientId}`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
