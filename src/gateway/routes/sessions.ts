/**
 * REST API routes for session management.
 *
 * Used by the WebUI for listing, creating, renaming, and deleting sessions.
 * Main session (main.jsonl) is not managed here — it's implicit and always
 * exists. These routes manage additional UUID-based sessions.
 *
 * Auth: Same Bearer token as the WebSocket gateway.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../config";
import {
  createSession,
  listSessions,
  getSession,
  updateSession,
  deleteSession,
} from "../../sessions/store";
import { timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Auth middleware — same as schedules.ts
// ---------------------------------------------------------------------------

/**
 * Validate the Bearer token from the Authorization header.
 *
 * @param request - The incoming Fastify request
 * @param reply - The Fastify reply object for sending error responses
 * @returns True if authenticated, false if rejected (reply already sent)
 */
function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = config.gateway.wsToken;
  if (!token) {
    reply.code(503).send({ error: "Gateway token not configured" });
    return false;
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return false;
  }

  const provided = auth.slice(7);
  const a = Buffer.from(token, "utf-8");
  const b = Buffer.from(provided, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "Invalid token" });
    return false;
  }

  return true;
}

/**
 * Resolve the user ID for session operations. Currently returns the first
 * user in config (single-user simplification).
 *
 * @returns User ID string
 */
function resolveUser(): string {
  const userIds = Object.keys(config.users);
  return userIds[0] ?? "local";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register session management routes on the Fastify instance.
 *
 * @param app - The Fastify server instance
 */
export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/sessions — list all sessions (WebUI sidebar) */
  app.get("/api/sessions", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const userId = resolveUser();
    const sessions = listSessions(userId);

    return {
      sessions: sessions.map(([id, entry]) => ({
        id,
        ...entry,
      })),
    };
  });

  /** GET /api/sessions/:id — get a specific session */
  app.get("/api/sessions/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const userId = resolveUser();
    const entry = getSession(userId, id);

    if (!entry) {
      reply.code(404).send({ error: `Session ${id} not found` });
      return;
    }

    return { id, ...entry };
  });

  /** POST /api/sessions — create a new session (WebUI "New Chat") */
  app.post("/api/sessions", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body as { agentId?: string; label?: string } | undefined;
    const agentId = body?.agentId ?? config.defaultAgent;
    const label = body?.label ?? "New Chat";

    // Validate agent exists
    if (!config.agents[agentId]) {
      reply.code(400).send({ error: `Unknown agent: ${agentId}` });
      return;
    }

    const userId = resolveUser();
    const sessionId = createSession(userId, agentId, label, "webui");

    reply.code(201).send({ id: sessionId, agentId, label });
  });

  /** PATCH /api/sessions/:id — update session (rename label) */
  app.patch("/api/sessions/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = request.body as { label?: string } | undefined;

    if (!body?.label) {
      reply.code(400).send({ error: "Missing field: label" });
      return;
    }

    const userId = resolveUser();
    const updated = updateSession(userId, id, { label: body.label });

    if (!updated) {
      reply.code(404).send({ error: `Session ${id} not found` });
      return;
    }

    return { ok: true };
  });

  /** DELETE /api/sessions/:id — delete a session */
  app.delete("/api/sessions/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params as { id: string };
    const userId = resolveUser();
    const deleted = deleteSession(userId, id);

    if (!deleted) {
      reply.code(404).send({ error: `Session ${id} not found` });
      return;
    }

    return { ok: true };
  });
}
