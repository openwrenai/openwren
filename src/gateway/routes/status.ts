/**
 * REST API route for system status.
 *
 * Endpoint:
 *   GET /api/status — system health, agent list, channel status, memory count
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "fs";
import * as path from "path";
import { config, agentMemoryDir } from "../../config";
import { timingSafeEqual } from "crypto";

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

function countMemoryFiles(): number {
  let total = 0;
  const agentsDir = path.join(config.workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return 0;

  for (const agentId of Object.keys(config.agents)) {
    const memDir = agentMemoryDir(agentId);
    if (fs.existsSync(memDir)) {
      const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md"));
      total += files.length;
    }
  }
  return total;
}

function countSessions(): number {
  const sessionsDir = path.join(config.workspaceDir, "sessions");
  if (!fs.existsSync(sessionsDir)) return 0;

  let total = 0;
  for (const userId of fs.readdirSync(sessionsDir)) {
    const userDir = path.join(sessionsDir, userId);
    if (!fs.statSync(userDir).isDirectory()) continue;
    for (const agentDir of fs.readdirSync(userDir)) {
      const agentPath = path.join(userDir, agentDir);
      if (!fs.statSync(agentPath).isDirectory()) continue;
      const jsonl = fs.readdirSync(agentPath).filter((f) => f.endsWith(".jsonl"));
      total += jsonl.length;
    }
  }
  return total;
}

function getChannelStatus(): Array<{ name: string; configured: boolean }> {
  const channelNames = ["telegram", "discord", "websocket"];
  return channelNames.map((name) => {
    if (name === "websocket") {
      return { name, configured: !!config.gateway.wsToken };
    }
    const bindings = config.bindings[name] ?? {};
    const configured = Object.keys(bindings).length > 0;
    return { name, configured };
  });
}

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/status", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const uptimeSeconds = Math.floor(process.uptime());
    const agents = Object.entries(config.agents).map(([id, agent]) => ({
      id,
      name: agent.name || id,
      model: agent.model ?? null,
      role: agent.role ?? null,
    }));

    return {
      uptime: uptimeSeconds,
      agents,
      agentCount: agents.length,
      sessionCount: countSessions(),
      memoryFileCount: countMemoryFiles(),
      channels: getChannelStatus(),
    };
  });
}
