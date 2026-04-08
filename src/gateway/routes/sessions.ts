/**
 * REST API routes for session management.
 *
 * Used by the WebUI for listing, creating, renaming, and deleting sessions.
 * Main session (main.jsonl) is not managed here — it's implicit and always
 * exists. These routes manage additional UUID-based sessions.
 *
 * Auth: Same Bearer token as the WebSocket gateway.
 */

import * as fs from "fs";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config, userNamedSessionPath } from "../../config";
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

    /**
     * GET /api/sessions/:id/messages — load session history with pagination.
     *
     * Reads the session JSONL file and transforms raw TimestampedMessage objects
     * (AI SDK format) into a flat ChatItem array the frontend can render directly.
     *
     * Query params:
     *   limit  — max messages to return (default 50)
     *   before — timestamp (ms). Returns messages older than this. Used for
     *            scroll-up pagination to load earlier history.
     *
     * Response: { messages: ChatItem[], total: number }
     *   total is the full message count in the session, so the frontend knows
     *   when there are no more messages to prefetch.
     *
     * Transform rules:
     *   - role "user" with string content → TextItem { kind: "text", role: "user" }
     *   - role "assistant" with string content → TextItem { kind: "text", role: "assistant" }
     *   - role "assistant" with tool-call content → ToolCallItem(s) { kind: "tool_call" }
     *   - role "tool" with tool-result content → updates the preceding ToolCallItem with result
     *   - Timestamps stripped from text content (model sometimes echoes them back)
     */
    app.get("/api/sessions/:id/messages", async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const { id } = request.params as { id: string };
      const query = request.query as { limit?: string; before?: string };
      const limit = Math.min(parseInt(query.limit ?? "50", 10) || 50, 200);
      const before = query.before ? parseInt(query.before, 10) : undefined;

      const userId = resolveUser();
      const entry = getSession(userId, id);
      if (!entry) {
        reply.code(404).send({ error: `Session ${id} not found` });
        return;
      }

      const sessionFile = userNamedSessionPath(userId, id);
      if (!fs.existsSync(sessionFile)) {
        return { messages: [], total: 0 };
      }

      // Parse all JSONL lines into timestamped messages
      const raw = fs.readFileSync(sessionFile, "utf-8").trim();
      if (!raw) {
        return { messages: [], total: 0 };
      }

      const lines = raw.split("\n");
      const allMessages: Array<{ timestamp: number; role: string; content: unknown }> = [];
      for (const line of lines) {
        try {
          allMessages.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }

      const total = allMessages.length;

      // Filter by `before` timestamp for pagination
      let filtered = before
        ? allMessages.filter((m) => m.timestamp < before)
        : allMessages;

      // Take the last `limit` messages (most recent)
      const sliced = filtered.slice(-limit);

      // Timestamp regex — strip echoed timestamps from model responses
      const TIMESTAMP_RE = /\[(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{2}:\d{2}\]\s*/g;

      // Transform JSONL messages into ChatItem-compatible shape
      interface ChatItemResponse {
        kind: "text" | "tool_call";
        role?: "user" | "assistant";
        text?: string;
        toolCallId?: string;
        toolName?: string;
        args?: Record<string, unknown>;
        result?: string;
        timestamp: number;
      }

      const items: ChatItemResponse[] = [];

      // Map toolCallId → index in items array, so tool-result messages can
      // update the matching tool_call item with the result
      const toolCallIndex = new Map<string, number>();

      for (const msg of sliced) {
        const content = msg.content;

        if (typeof content === "string") {
          // Plain text message (user or assistant)
          items.push({
            kind: "text",
            role: msg.role as "user" | "assistant",
            text: content.replace(TIMESTAMP_RE, ""),
            timestamp: msg.timestamp,
          });
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool-call") {
              // Assistant requested a tool call
              const idx = items.length;
              items.push({
                kind: "tool_call",
                toolCallId: block.toolCallId,
                toolName: block.toolName,
                args: block.input ?? {},
                timestamp: msg.timestamp,
              });
              toolCallIndex.set(block.toolCallId, idx);
            } else if (block.type === "tool-result") {
              // Tool result — find the matching tool_call and attach the result
              const idx = toolCallIndex.get(block.toolCallId);
              if (idx !== undefined && items[idx]) {
                const resultText = typeof block.output === "string"
                  ? block.output
                  : block.output?.value ?? JSON.stringify(block.output);
                items[idx].result = resultText.slice(0, 500);
              }
            } else if (block.type === "text") {
              // Text block inside a content array
              items.push({
                kind: "text",
                role: msg.role as "user" | "assistant",
                text: (block.text ?? "").replace(TIMESTAMP_RE, ""),
                timestamp: msg.timestamp,
              });
            }
          }
        }
      }

      return { messages: items, total };
    });
}
