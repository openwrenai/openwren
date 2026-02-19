import Fastify from "fastify";
import { config } from "../config";

/**
 * Creates and starts the Fastify gateway server.
 * In development (long polling) this server is minimal — just a health check.
 * In production (webhook mode) this is where Telegram POST requests come in.
 */
export async function startGateway(): Promise<void> {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = "127.0.0.1"; // never expose to 0.0.0.0

  await app.listen({ port, host });
  console.log(`[gateway] Listening on http://${host}:${port}`);
}
