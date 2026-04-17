/**
 * REST API routes for team management.
 *
 * Endpoints:
 *   GET    /api/teams         — list all teams
 *   GET    /api/teams/:name   — get single team detail
 *   POST   /api/teams         — create new team
 *   PATCH  /api/teams/:name   — update team
 *   DELETE /api/teams/:name   — delete team
 *
 * Auth: Same Bearer token as the WebSocket gateway.
 */

import * as fs from "fs";
import * as path from "path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config, reloadConfig } from "../../config";
import { writeConfigKeys, removeConfigKeys, readRawConfig } from "../../config-writer";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TeamJson {
  name: string;
  displayName: string;
  manager: { id: string; name: string };
  members: Array<{ id: string; name: string }>;
}

function teamToJson(teamName: string): TeamJson | null {
  const team = config.teams[teamName];
  if (!team) return null;

  const managerAgent = config.agents[team.manager];
  return {
    name: teamName,
    displayName: team.name || teamName,
    manager: {
      id: team.manager,
      name: managerAgent?.name || team.manager,
    },
    members: team.members.map((id) => ({
      id,
      name: config.agents[id]?.name || id,
    })),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/teams — list all teams
  app.get("/api/teams", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const teams: TeamJson[] = [];
    for (const name of Object.keys(config.teams)) {
      const t = teamToJson(name);
      if (t) teams.push(t);
    }

    return { teams };
  });

  // GET /api/teams/:name — single team detail
  app.get<{ Params: { name: string } }>("/api/teams/:name", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { name } = request.params;
    const team = teamToJson(name);
    if (!team) {
      return reply.code(404).send({ error: `Team "${name}" not found` });
    }

    return team;
  });

  // POST /api/teams — create new team
  app.post<{
    Body: { name: string; displayName?: string; managerId: string; memberIds: string[] };
  }>("/api/teams", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body;
    if (!body?.name || !body?.managerId) {
      return reply.code(400).send({ error: "name and managerId are required" });
    }

    const name = body.name;
    const displayName = body.displayName;
    const managerId = body.managerId;
    const memberIds = body.memberIds ?? [];

    // Validate name format
    if (!/^[a-z0-9_]+$/.test(name)) {
      return reply.code(400).send({ error: "Team name must be lowercase alphanumeric and underscores only" });
    }

    // Check team doesn't already exist
    if (config.teams[name]) {
      return reply.code(409).send({ error: `Team "${name}" already exists` });
    }

    // Validate manager exists
    if (!config.agents[managerId]) {
      return reply.code(400).send({ error: `Manager agent "${managerId}" not found` });
    }

    // Validate all members exist and manager is not in members
    for (const mid of memberIds) {
      if (!config.agents[mid]) {
        return reply.code(400).send({ error: `Member agent "${mid}" not found` });
      }
    }
    if (memberIds.includes(managerId)) {
      return reply.code(400).send({ error: "Manager cannot be in the members list" });
    }

    // Write config keys
    const keys: Record<string, unknown> = {
      [`teams.${name}.manager`]: managerId,
      [`teams.${name}.members`]: memberIds,
    };
    if (displayName) keys[`teams.${name}.name`] = displayName;

    writeConfigKeys(keys);
    reloadConfig();

    // Create team directory on disk
    const teamDir = path.join(config.workspaceDir, "teams", name);
    if (!fs.existsSync(teamDir)) {
      fs.mkdirSync(teamDir, { recursive: true });
    }

    return teamToJson(name);
  });

  // PATCH /api/teams/:name — update team
  app.patch<{
    Params: { name: string };
    Body: { displayName?: string; managerId?: string; memberIds?: string[] };
  }>("/api/teams/:name", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { name } = request.params;
    if (!config.teams[name]) {
      return reply.code(404).send({ error: `Team "${name}" not found` });
    }

    const body = request.body ?? {};
    const keys: Record<string, unknown> = {};
    const toRemove: string[] = [];

    // Update display name if provided
    if (body.displayName !== undefined) {
      if (body.displayName) {
        keys[`teams.${name}.name`] = body.displayName;
      } else {
        toRemove.push(`teams.${name}.name`);
      }
    }

    const currentTeam = config.teams[name];
    const newManagerId = body.managerId ?? currentTeam.manager;
    const newMemberIds = body.memberIds ?? currentTeam.members;

    // Validate manager exists
    if (body.managerId !== undefined) {
      if (!config.agents[newManagerId]) {
        return reply.code(400).send({ error: `Manager agent "${newManagerId}" not found` });
      }
      keys[`teams.${name}.manager`] = newManagerId;
    }

    // Validate all members exist
    if (body.memberIds !== undefined) {
      for (const mid of newMemberIds) {
        if (!config.agents[mid]) {
          return reply.code(400).send({ error: `Member agent "${mid}" not found` });
        }
      }
      if (newMemberIds.includes(newManagerId)) {
        return reply.code(400).send({ error: "Manager cannot be in the members list" });
      }
      keys[`teams.${name}.members`] = newMemberIds;
    }

    if (Object.keys(keys).length > 0) writeConfigKeys(keys);
    if (toRemove.length > 0) removeConfigKeys(toRemove);
    reloadConfig();

    return teamToJson(name);
  });

  // DELETE /api/teams/:name — remove team from config
  app.delete<{ Params: { name: string } }>("/api/teams/:name", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { name } = request.params;
    if (!config.teams[name]) {
      return reply.code(404).send({ error: `Team "${name}" not found` });
    }

    // Find and remove all teams.{name}.* keys
    const raw = readRawConfig();
    const keysToRemove = Object.keys(raw).filter(
      (k) => k === `teams.${name}` || k.startsWith(`teams.${name}.`)
    );
    if (keysToRemove.length > 0) removeConfigKeys(keysToRemove);
    reloadConfig();

    return { deleted: true };
  });
}
