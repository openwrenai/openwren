/**
 * REST API routes for agent management.
 *
 * Endpoints:
 *   GET    /api/agents              — list all agents
 *   GET    /api/agents/:id          — get single agent config
 *   PATCH  /api/agents/:id          — update agent config (partial)
 *   POST   /api/agents              — create new agent
 *   DELETE /api/agents/:id          — delete agent (config only)
 *   GET    /api/agents/:id/files    — list known agent files with existence status
 *   GET    /api/agents/:id/files/:filename — read file content
 *   PUT    /api/agents/:id/files/:filename — write file content
 *   GET    /api/models              — list all providers and models
 *
 * Auth: Same Bearer token as the WebSocket gateway.
 */

import * as fs from "fs";
import * as path from "path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config, reloadConfig } from "../../config";
import { writeConfigKeys, removeConfigKeys } from "../../config-writer";
import { defaultSoul } from "../../workspace";
import { getSkillInventory } from "../../agent/skills";
import { getAgentCandidateTools, getToolCategory, getAgentRoleFromTeams } from "../../tools/categories";
import { getToolDefinitionByName } from "../../tools";
import { getTeamsForAgent } from "../../config";
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

/** Whitelist of agent files that can be read/written via the API. */
const ALLOWED_FILES = ["soul.md", "heartbeat.md", "workflow.md"];

function agentDir(agentId: string): string {
  return path.join(config.workspaceDir, "agents", agentId);
}

function agentToJson(id: string) {
  const agent = config.agents[id];
  const teams = getTeamsForAgent(id);
  return {
    id,
    name: agent.name || id,
    model: agent.model ?? null,
    fallback: agent.fallback ?? null,
    description: agent.description ?? null,
    isManager: teams.some((t) => t.role === "manager"),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/agents — list all agents
  app.get("/api/agents", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const agents = Object.keys(config.agents).map((id) => ({
      id,
      name: config.agents[id].name || id,
    }));
    return { agents };
  });

  // GET /api/agents/:id — single agent detail
  app.get<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    if (!config.agents[id]) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    return {
      ...agentToJson(id),
      defaultModel: config.defaultModel,
      defaultFallback: config.defaultFallback,
    };
  });

  // GET /api/agents/:id/files — list known files with existence status
  app.get<{ Params: { id: string } }>("/api/agents/:id/files", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    if (!config.agents[id]) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const dir = agentDir(id);
    const files = ALLOWED_FILES.map((name) => ({
      name,
      exists: fs.existsSync(path.join(dir, name)),
    }));

    return { files };
  });

  // GET /api/agents/:id/files/:filename — read file content
  app.get<{ Params: { id: string; filename: string } }>(
    "/api/agents/:id/files/:filename",
    async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const { id, filename } = request.params;
      if (!config.agents[id]) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }
      if (!ALLOWED_FILES.includes(filename)) {
        return reply.code(400).send({ error: `File "${filename}" is not an allowed agent file` });
      }

      const filePath = path.join(agentDir(id), filename);
      let content = "";
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf-8");
      }

      return { name: filename, content };
    }
  );

  // PUT /api/agents/:id/files/:filename — write file content
  app.put<{ Params: { id: string; filename: string }; Body: { content: string } }>(
    "/api/agents/:id/files/:filename",
    async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const { id, filename } = request.params;
      if (!config.agents[id]) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }
      if (!ALLOWED_FILES.includes(filename)) {
        return reply.code(400).send({ error: `File "${filename}" is not an allowed agent file` });
      }

      const body = request.body;
      if (typeof body?.content !== "string") {
        return reply.code(400).send({ error: "Request body must include 'content' string" });
      }

      const dir = agentDir(id);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(path.join(dir, filename), body.content, "utf-8");
      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // Channels (Step 4e)
  // -------------------------------------------------------------------------

  // GET /api/agents/:id/channels — list bound messaging channels
  app.get<{ Params: { id: string } }>("/api/agents/:id/channels", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    if (!config.agents[id]) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const channels: Array<{ name: string }> = [];
    for (const [channelName, agentMap] of Object.entries(config.bindings ?? {})) {
      const binding = (agentMap as Record<string, string>)[id];
      if (binding) {
        channels.push({ name: channelName });
      }
    }

    return { channels };
  });

  // -------------------------------------------------------------------------
  // Skills (Step 4d)
  // -------------------------------------------------------------------------

  // GET /api/agents/:id/skills — list all skills with gate status
  app.get<{ Params: { id: string } }>("/api/agents/:id/skills", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    if (!config.agents[id]) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const skills = getSkillInventory(id);
    const enabledCount = skills.filter((s) => s.enabled).length;

    return { skills, total: skills.length, enabled: enabledCount };
  });

  // PATCH /api/agents/:id/skills — update skill enable/disable overrides
  app.patch<{ Params: { id: string }; Body: { entries: Record<string, { enabled: boolean }> } }>(
    "/api/agents/:id/skills",
    async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const { id } = request.params;
      if (!config.agents[id]) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const body = request.body;
      if (!body?.entries || typeof body.entries !== "object") {
        return reply.code(400).send({ error: "Request body must include 'entries' object" });
      }

      const toWrite: Record<string, unknown> = {};
      const toRemove: string[] = [];

      for (const [skillName, settings] of Object.entries(body.entries)) {
        // Determine what the global state is (without per-agent override)
        const globalEntry = config.skills?.entries?.[skillName];
        const globalEnabled = globalEntry?.enabled !== false; // true if not explicitly disabled

        if (settings.enabled === globalEnabled) {
          // Per-agent choice matches global — remove override (no need to store it)
          toRemove.push(`agents.${id}.skills.${skillName}.enabled`);
        } else {
          // Per-agent choice differs from global — store override
          toWrite[`agents.${id}.skills.${skillName}.enabled`] = settings.enabled;
        }
      }

      if (Object.keys(toWrite).length > 0) writeConfigKeys(toWrite);
      if (toRemove.length > 0) removeConfigKeys(toRemove);
      reloadConfig();

      const skills = getSkillInventory(id);
      const enabledCount = skills.filter((s) => s.enabled).length;

      return { skills, total: skills.length, enabled: enabledCount };
    }
  );

  // -------------------------------------------------------------------------
  // Tools (Step 6.a)
  // -------------------------------------------------------------------------

  // GET /api/agents/:id/tools — list candidate tools with enabled state + role context
  app.get<{ Params: { id: string } }>("/api/agents/:id/tools", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    if (!config.agents[id]) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    const candidates = getAgentCandidateTools(id);
    const disabled = new Set(config.agents[id].disabledTools ?? []);
    const teams = getTeamsForAgent(id);
    const role = getAgentRoleFromTeams(id);

    const tools = candidates.map((name) => {
      const def = getToolDefinitionByName(name);
      return {
        name,
        description: def?.description ?? "",
        category: getToolCategory(name) ?? "base",
        enabled: !disabled.has(name),
      };
    });

    const enabledCount = tools.filter((t) => t.enabled).length;
    const managedTeams = teams.filter((t) => t.role === "manager").map((t) => t.name);
    const memberTeams = teams.filter((t) => t.role === "member").map((t) => t.name);

    return {
      tools,
      total: tools.length,
      enabled: enabledCount,
      role,
      managedTeams,
      memberTeams,
    };
  });

  // PATCH /api/agents/:id/tools — update disabledTools list
  app.patch<{ Params: { id: string }; Body: { entries: Record<string, { enabled: boolean }> } }>(
    "/api/agents/:id/tools",
    async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const { id } = request.params;
      if (!config.agents[id]) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const body = request.body;
      if (!body?.entries || typeof body.entries !== "object") {
        return reply.code(400).send({ error: "Request body must include 'entries' object" });
      }

      const candidates = new Set(getAgentCandidateTools(id));
      // Compute new disabledTools: every candidate tool explicitly set to enabled=false
      // (manager/worker entries are ignored on write — they're not user-controllable)
      const current = new Set(config.agents[id].disabledTools ?? []);
      for (const [toolName, settings] of Object.entries(body.entries)) {
        if (!candidates.has(toolName)) continue;
        const category = getToolCategory(toolName);
        // Only BASE tools are user-togglable; ignore any manager/worker entries
        if (category !== "base") continue;
        if (settings.enabled) {
          current.delete(toolName);
        } else {
          current.add(toolName);
        }
      }

      const newDisabled = [...current].filter((n) => candidates.has(n));
      if (newDisabled.length > 0) {
        writeConfigKeys({ [`agents.${id}.disabledTools`]: newDisabled });
      } else {
        removeConfigKeys([`agents.${id}.disabledTools`]);
      }
      reloadConfig();

      // Return same shape as GET
      const disabled = new Set(config.agents[id].disabledTools ?? []);
      const teams = getTeamsForAgent(id);
      const role = getAgentRoleFromTeams(id);
      const tools = getAgentCandidateTools(id).map((name) => {
        const def = getToolDefinitionByName(name);
        return {
          name,
          description: def?.description ?? "",
          category: getToolCategory(name) ?? "base",
          enabled: !disabled.has(name),
        };
      });
      const enabledCount = tools.filter((t) => t.enabled).length;
      return {
        tools,
        total: tools.length,
        enabled: enabledCount,
        role,
        managedTeams: teams.filter((t) => t.role === "manager").map((t) => t.name),
        memberTeams: teams.filter((t) => t.role === "member").map((t) => t.name),
      };
    }
  );

  // -------------------------------------------------------------------------
  // CRUD — config mutations (Step 4b)
  // -------------------------------------------------------------------------

  // PATCH /api/agents/:id — partial update
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/agents/:id",
    async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const { id } = request.params;
      if (!config.agents[id]) {
        return reply.code(404).send({ error: `Agent "${id}" not found` });
      }

      const body = request.body ?? {};
      const allowedFields = ["name", "description", "model", "fallback"];
      const toWrite: Record<string, unknown> = {};
      const toRemove: string[] = [];

      for (const field of allowedFields) {
        if (!(field in body)) continue;
        const val = body[field];
        if (val === null || val === "") {
          // null or empty = remove override
          toRemove.push(`agents.${id}.${field}`);
        } else {
          toWrite[`agents.${id}.${field}`] = val;
        }
      }

      if (Object.keys(toWrite).length > 0) writeConfigKeys(toWrite);
      if (toRemove.length > 0) removeConfigKeys(toRemove);
      reloadConfig();

      return { ...agentToJson(id), defaultModel: config.defaultModel };
    }
  );

  // POST /api/agents — create new agent
  app.post<{ Body: { id: string; name: string; description?: string; model?: string; fallback?: string } }>(
    "/api/agents",
    async (request, reply) => {
      if (!authenticate(request, reply)) return;

      const body = request.body;
      if (!body?.id || !body?.name) {
        return reply.code(400).send({ error: "id and name are required" });
      }

      const id = body.id;

      // Validate ID format
      if (!/^[a-z0-9_]+$/.test(id)) {
        return reply.code(400).send({ error: "Agent ID must be lowercase alphanumeric and underscores only" });
      }

      if (config.agents[id]) {
        return reply.code(409).send({ error: `Agent "${id}" already exists` });
      }

      // Write config keys
      const keys: Record<string, unknown> = {
        [`agents.${id}.name`]: body.name,
      };
      if (body.description) keys[`agents.${id}.description`] = body.description;
      if (body.model) keys[`agents.${id}.model`] = body.model;
      if (body.fallback) keys[`agents.${id}.fallback`] = body.fallback;

      writeConfigKeys(keys);
      reloadConfig();

      // Create on-disk structure
      const dir = agentDir(id);
      const subdirs = [
        dir,
        path.join(dir, "memory"),
        path.join(dir, "workspace"),
        path.join(dir, "sessions", "jobs"),
        path.join(dir, "sessions", "tasks"),
      ];
      for (const d of subdirs) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      }

      // Create soul.md stub
      const soulPath = path.join(dir, "soul.md");
      if (!fs.existsSync(soulPath)) {
        fs.writeFileSync(soulPath, defaultSoul(id, body.name), "utf-8");
      }

      // Create per-user session directories
      for (const userId of Object.keys(config.users)) {
        const sessDir = path.join(config.workspaceDir, "sessions", userId, id);
        const archDir = path.join(sessDir, "archives");
        if (!fs.existsSync(archDir)) fs.mkdirSync(archDir, { recursive: true });
      }

      return { ...agentToJson(id), defaultModel: config.defaultModel };
    }
  );

  // DELETE /api/agents/:id — remove from config (preserves files on disk)
  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    if (!config.agents[id]) {
      return reply.code(404).send({ error: `Agent "${id}" not found` });
    }

    // Check team references
    for (const [teamName, team] of Object.entries(config.teams)) {
      if (team.manager === id || team.members.includes(id)) {
        return reply.code(400).send({
          error: `Cannot delete "${id}" — referenced in team "${teamName}". Remove from team first.`,
        });
      }
    }

    // Find and remove all agents.{id}.* keys
    const { readRawConfig } = await import("../../config-writer");
    const raw = readRawConfig();
    const keysToRemove = Object.keys(raw).filter(
      (k) => k === `agents.${id}` || k.startsWith(`agents.${id}.`)
    );
    if (keysToRemove.length > 0) removeConfigKeys(keysToRemove);
    reloadConfig();

    return { deleted: true };
  });

  // -------------------------------------------------------------------------
  // Models endpoint
  // -------------------------------------------------------------------------

  const STATIC_MODELS: Record<string, string[]> = {
    anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
    google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "mixtral-8x7b-32768"],
    xai: ["grok-3", "grok-3-mini"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
  };

  app.get("/api/models", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const providers: Array<{ id: string; models: string[] }> = [];

    // Static providers — only include those with a configured API key
    for (const [id, models] of Object.entries(STATIC_MODELS)) {
      const providerConfig = (config.providers as Record<string, Record<string, string>>)[id];
      if (providerConfig?.apiKey) {
        providers.push({ id, models });
      }
    }

    // Ollama — dynamic from local API
    try {
      const ollamaUrl = config.providers.ollama.baseUrl || "http://localhost:11434";
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const models = (data.models ?? []).map((m) => m.name);
        providers.push({ id: "ollama", models });
      } else {
        providers.push({ id: "ollama", models: [] });
      }
    } catch {
      providers.push({ id: "ollama", models: [] });
    }

    // llmgateway — union of all other providers
    const allModels = new Set<string>();
    for (const p of providers) {
      for (const m of p.models) allModels.add(m);
    }
    providers.push({ id: "llmgateway", models: [...allModels] });

    return { defaultModel: config.defaultModel, providers };
  });
}
