import Fastify, { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { config } from "../config";
import { registerScheduleRoutes } from "./routes/schedules";
import { registerSessionRoutes } from "./routes/sessions";
import { registerUsageRoutes } from "./routes/usage";

/** The Fastify instance — available after startGateway() resolves. */
export let app: FastifyInstance;

/**
 * Callback for WebSocket connections — set by the WS channel before
 * startGateway() is called. If null, no /ws route is registered.
 */
export let wsConnectionHandler: ((socket: any, request: any) => void) | null = null;

export function setWsConnectionHandler(handler: (socket: any, request: any) => void): void {
  wsConnectionHandler = handler;
}

/**
 * Creates and starts the Fastify HTTP server.
 * Registers the WebSocket plugin and /ws route (if configured) before listening.
 * Bound to 127.0.0.1 only — never exposed to the public internet.
 */
export async function startGateway(): Promise<void> {
  app = Fastify({ logger: false });

  // Register WebSocket support — must come before route declarations.
  await app.register(websocket);

  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Register /ws route if the WS channel set up a handler (before listen)
  if (wsConnectionHandler && config.gateway.wsToken) {
    app.get("/ws", { websocket: true }, wsConnectionHandler);
    console.log("[websocket] WebSocket route registered at /ws");
  }

  // Register REST API routes
  await registerScheduleRoutes(app);
  await registerSessionRoutes(app);
  await registerUsageRoutes(app);

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = "127.0.0.1"; // never expose to 0.0.0.0

  await app.listen({ port, host });
  console.log(`[gateway] Listening on http://${host}:${port}`);
}
