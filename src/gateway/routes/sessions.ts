/**
 * REST API routes for session management.
 *
 * One session per agent — no UUIDs, no session index.
 * Sessions live at sessions/{userId}/{agentId}/session.jsonl.
 *
 * Auth: Same Bearer token as the WebSocket gateway.
 */

import * as fs from "fs";
import * as path from "path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config, agentSessionPath, agentSessionArchiveDir, userSessionDir } from "../../config";
import { timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  const tok = config.gateway.wsToken;
  if (!tok) {
    reply.code(503).send({ error: "Gateway not configured" });
    return false;
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return false;
  }

  const provided = auth.slice(7);
  const a = Buffer.from(tok, "utf-8");
  const b = Buffer.from(provided, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "Invalid credentials" });
    return false;
  }

  return true;
}

function resolveUser(): string {
  const userIds = Object.keys(config.users);
  return userIds[0] ?? "local";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/sessions — list all agent sessions.
   * Scans sessions/{userId}/ for directories containing session.jsonl.
   */
  app.get("/api/sessions", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const userId = resolveUser();
    const sessionsDir = userSessionDir(userId);

    const sessions: Array<{ agentId: string; agentName: string; hasHistory: boolean }> = [];

    for (const [agentId, agentConfig] of Object.entries(config.agents)) {
      const sessionFile = agentSessionPath(userId, agentId);
      const hasHistory = fs.existsSync(sessionFile) && fs.readFileSync(sessionFile, "utf-8").trim().length > 0;
      sessions.push({
        agentId,
        agentName: agentConfig.name || agentId,
        hasHistory,
      });
    }

    return { sessions };
  });

  /**
   * GET /api/sessions/:agentId/messages — paginated session history.
   */
  app.get("/api/sessions/:agentId/messages", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { agentId } = request.params as { agentId: string };
    const query = request.query as { limit?: string; before?: string };
    const limit = Math.min(parseInt(query.limit ?? "50", 10) || 50, 200);
    const before = query.before ? parseInt(query.before, 10) : undefined;

    if (!config.agents[agentId]) {
      reply.code(404).send({ error: `Unknown agent: ${agentId}` });
      return;
    }

    const userId = resolveUser();
    const sessionFile = agentSessionPath(userId, agentId);

    if (!fs.existsSync(sessionFile)) {
      return { messages: [], total: 0 };
    }

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

    let filtered = before
      ? allMessages.filter((m) => m.timestamp < before)
      : allMessages;

    const sliced = filtered.slice(-limit);

    const TIMESTAMP_RE = /\[(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{2}:\d{2}\]\s*/g;

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
    const toolCallIndex = new Map<string, number>();

    for (const msg of sliced) {
      const content = msg.content;

      if (typeof content === "string") {
        items.push({
          kind: "text",
          role: msg.role as "user" | "assistant",
          text: content.replace(TIMESTAMP_RE, ""),
          timestamp: msg.timestamp,
        });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool-call") {
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
            const idx = toolCallIndex.get(block.toolCallId);
            if (idx !== undefined && items[idx]) {
              const resultText = typeof block.output === "string"
                ? block.output
                : block.output?.value ?? JSON.stringify(block.output);
              items[idx].result = resultText.slice(0, 500);
            }
          } else if (block.type === "text") {
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

  /**
   * POST /api/sessions/:agentId/clear — archive session and start fresh.
   */
  app.post("/api/sessions/:agentId/clear", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { agentId } = request.params as { agentId: string };
    if (!config.agents[agentId]) {
      reply.code(404).send({ error: `Unknown agent: ${agentId}` });
      return;
    }

    const userId = resolveUser();
    const sessionFile = agentSessionPath(userId, agentId);

    if (!fs.existsSync(sessionFile) || !fs.readFileSync(sessionFile, "utf-8").trim()) {
      return { ok: true, message: "Session already empty" };
    }

    // Archive
    const archDir = agentSessionArchiveDir(userId, agentId);
    if (!fs.existsSync(archDir)) {
      fs.mkdirSync(archDir, { recursive: true });
    }

    const now = new Date();
    const ts = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    ].join("-") + "_" + [
      String(now.getUTCHours()).padStart(2, "0"),
      String(now.getUTCMinutes()).padStart(2, "0"),
      String(now.getUTCSeconds()).padStart(2, "0"),
    ].join("-");

    const archivePath = path.join(archDir, `session-${ts}.jsonl`);
    fs.renameSync(sessionFile, archivePath);
    console.log(`[sessions] Cleared ${agentId} session -> archives/session-${ts}.jsonl`);

    return { ok: true };
  });
}
