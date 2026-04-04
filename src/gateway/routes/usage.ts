/**
 * REST API routes for token usage tracking.
 *
 * Endpoints:
 *   GET /api/usage          — summary (totals by day, agent, provider, session)
 *   GET /api/usage/detail   — daily JSONL entries for drill-down (?date=YYYY-MM-DD)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../config";
import { loadSummary, loadDailyEntries } from "../../usage";
import { timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Auth middleware — same pattern as schedule routes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/usage — summary with optional filters */
  app.get("/api/usage", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const query = request.query as {
      days?: string;
      agent?: string;
      provider?: string;
    };

    const summary = loadSummary();

    // Filter days if requested
    if (query.days) {
      const numDays = parseInt(query.days, 10);
      if (!isNaN(numDays) && numDays > 0) {
        const sortedDays = Object.keys(summary.days).sort().reverse();
        const kept = new Set(sortedDays.slice(0, numDays));
        for (const key of Object.keys(summary.days)) {
          if (!kept.has(key)) delete summary.days[key];
        }
      }
    }

    // Filter byAgent if requested
    if (query.agent) {
      const agent = query.agent;
      const filtered: typeof summary.byAgent = {};
      if (summary.byAgent[agent]) filtered[agent] = summary.byAgent[agent];
      summary.byAgent = filtered;
    }

    // Filter byProvider if requested
    if (query.provider) {
      const provider = query.provider;
      const filtered: typeof summary.byProvider = {};
      if (summary.byProvider[provider]) filtered[provider] = summary.byProvider[provider];
      summary.byProvider = filtered;
    }

    return summary;
  });

  /** GET /api/usage/detail?date=YYYY-MM-DD — per-run entries for a day */
  app.get("/api/usage/detail", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const query = request.query as { date?: string };
    const date = query.date ?? new Date().toISOString().slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "Invalid date format — use YYYY-MM-DD" });
    }

    const entries = loadDailyEntries(date);
    return { date, entries };
  });
}
