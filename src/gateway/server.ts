import Fastify, { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { config } from "../config";
import { registerScheduleRoutes } from "./routes/schedules";
import { registerSessionRoutes } from "./routes/sessions";
import { registerUsageRoutes } from "./routes/usage";
import { registerStatusRoutes } from "./routes/status";
import { registerAgentRoutes } from "./routes/agents";

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
  await registerStatusRoutes(app);
  await registerAgentRoutes(app);

  // Serve webui/dist/ as static files (SPA with fallback to index.html)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webuiDist = resolve(__dirname, "../webui/dist");
  if (existsSync(webuiDist)) {
    await app.register(fastifyStatic, {
      root: webuiDist,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback — serve index.html for any non-API, non-WS route
    app.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile("index.html");
    });
  }

  const port = parseInt(process.env.GATEWAY_PORT ?? process.env.PORT ?? "3000", 10);
  const host = "127.0.0.1"; // never expose to 0.0.0.0

  await app.listen({ port, host });
  console.log(`[gateway] Listening on http://${host}:${port}`);

  if (config.gateway.wsToken) {
    const token = encodeURIComponent(config.gateway.wsToken);
    console.log(`[gateway] Dashboard: http://${host}:${port}?token=${token}`);
  }
}
