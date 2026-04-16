import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as dotenv from "dotenv";
import JSON5 from "json5";

// ---------------------------------------------------------------------------
// Workspace path — defaults to ~/.openwren, overridable via OPENWREN_HOME
// ---------------------------------------------------------------------------

const WORKSPACE_RAW = process.env.OPENWREN_HOME || "~/.openwren";

function resolveHome(raw: string): string {
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

const WORKSPACE_DIR = resolveHome(WORKSPACE_RAW);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface UserConfig {
  displayName: string;
  channelIds: Record<string, number | string>; // e.g. { telegram: 8300966403, discord: "..." }
}

/** Per-agent personality and model config. Channel-agnostic — bindings live in config.bindings. */
export interface AgentConfig {
  name: string;
  model?: string;       // "provider/model" override, e.g. "anthropic/claude-sonnet-4-6". Inherits defaultModel if unset.
  fallback?: string;    // Comma-separated fallback chain, e.g. "anthropic/claude-haiku-3-5, ollama/llama3.2"
  description?: string; // One-liner shown to managers via list_team and system prompt injection
  role?: string; // "manager" or "worker" (default: "worker") — maps to roles.{name} for tool permissions
  skills?: Record<string, { enabled?: boolean }>; // Per-agent skill overrides. Absent = inherit global.
}

/** Team config — defines manager-worker relationships. Independent of any single agent. */
export interface TeamConfig {
  name?: string;     // display name (e.g. "Görans Team"). Falls back to team ID if unset.
  manager: string;   // agent ID of the team manager
  members: string[]; // agent IDs in the team
}

/** Top-level application config. Loaded once at boot from ~/.openwren/openwren.json merged over defaults. */
export interface Config {
  defaultModel: string;    // "provider/model" format, e.g. "anthropic/claude-sonnet-4-6"
  defaultFallback: string; // Comma-separated fallback chain, e.g. "anthropic/claude-haiku-3-5, ollama/llama3.2"
  providers: {
    anthropic: {
      apiKey: string;      // Credentials only — model selection moved to defaultModel / agents.*.model
    };
    openai: {
      apiKey: string;
    };
    google: {
      apiKey: string;
    };
    mistral: {
      apiKey: string;
    };
    groq: {
      apiKey: string;
    };
    xai: {
      apiKey: string;
    };
    deepseek: {
      apiKey: string;
    };
    ollama: {
      baseUrl: string;
    };
    llmgateway: {
      apiKey: string;
    };
  };
  agents: Record<string, AgentConfig>;
  defaultAgent: string;
  users: Record<string, UserConfig>;
  channels: {
    unauthorizedBehavior: "silent" | "reject";
    rateLimit: {
      maxMessages: number;
      windowSeconds: number;
    };
  };
  bindings: Record<string, Record<string, string>>; // bindings[channel][agentId] = credential
  teams: Record<string, TeamConfig>; // teams[teamName] = { manager, members }
  roles: Record<string, string[]>;  // roles[roleName] = list of permitted tool names
  timezone: string;
  session: {
    idleResetMinutes: number;
    dailyResetTime: string; // "" = disabled, "04:00" = reset at 04:00
  };
  gateway: {
    wsToken: string; // Bearer token for WS auth. Empty = WS disabled.
  };
  search: {
    provider: string; // "brave", "zenserp", "searxng", etc. Empty = search disabled.
    brave: {
      apiKey: string;
    };
  };
  skills: {
    allowBundled?: string[];  // whitelist of bundled skill names. undefined = all allowed.
    entries: Record<string, { enabled?: boolean }>;
    load: {
      extraDirs: string[];
    };
  };
  scheduler: {
    enabled: boolean;
    runHistory: {
      logRetention: number;     // max run log entries per job (schedules/runs/*.jsonl)
      sessionRetention: number; // max runs to keep in isolated job sessions (sessions/*/jobs/*.jsonl)
    };
  };
  heartbeat: {
    enabled: boolean;
    every: string;     // interval string e.g. "30m"
    activeHours: {
      start: string;   // "HH:MM" e.g. "08:00", empty = no restriction
      end: string;     // "HH:MM" e.g. "22:00", empty = no restriction
    };
  };
  agent: {
    maxIterations: number;
    compaction: {
      enabled: boolean;
      contextWindowTokens: number;
      thresholdPercent: number;
    };
  };
  workspaceDir: string; // resolved absolute path — set internally, not user-facing
}

// ---------------------------------------------------------------------------
// Default config — always valid, always complete
// When updating this, also check src/templates/openwren.json and
// src/templates/env.template to keep templates in sync.
// ---------------------------------------------------------------------------

const defaultConfig: Omit<Config, "workspaceDir"> = {
  defaultModel: "anthropic/claude-sonnet-4-6",
  defaultFallback: "",
  providers: {
    anthropic: {
      apiKey: "",
    },
    openai: {
      apiKey: "",
    },
    google: {
      apiKey: "",
    },
    mistral: {
      apiKey: "",
    },
    groq: {
      apiKey: "",
    },
    xai: {
      apiKey: "",
    },
    deepseek: {
      apiKey: "",
    },
    ollama: {
      baseUrl: "http://localhost:11434",
    },
    llmgateway: {
      apiKey: "",
    },
  },
  agents: {
    atlas: {
      name: "Atlas",
    },
    einstein: {
      name: "Einstein",
    },
    wizard: {
      name: "Wizard",
    },
    personal_trainer: {
      name: "Coach",
    },
  },
  defaultAgent: "atlas",
  users: {
    owner: {
      displayName: "User",
      channelIds: {},
    },
  },
  channels: {
    unauthorizedBehavior: "reject",
    rateLimit: {
      maxMessages: 20,
      windowSeconds: 60,
    },
  },
  bindings: {},
  teams: {},
  roles: {
    manager: ["create_workflow", "delegate_task", "query_workflow", "read_file", "write_file", "save_memory", "memory_search"],
    worker: ["read_file", "write_file", "log_progress", "complete_task", "save_memory", "memory_search"],
  },
  gateway: {
    wsToken: "",
  },
  timezone: "",
  session: {
    idleResetMinutes: 0,
    dailyResetTime: "",
  },
  search: {
    provider: "",
    brave: {
      apiKey: "",
    },
  },
  skills: {
    entries: {},
    load: {
      extraDirs: [],
    },
  },
  scheduler: {
    enabled: true,
    runHistory: {
      logRetention: 500,
      sessionRetention: 50,
    },
  },
  heartbeat: {
    enabled: false,
    every: "30m",
    activeHours: {
      start: "",
      end: "",
    },
  },
  agent: {
    maxIterations: 10,
    compaction: {
      enabled: true,
      contextWindowTokens: 25000,
      thresholdPercent: 80,
    },
  },
};

// ---------------------------------------------------------------------------
// deepSet — inject a dot-notation key into a nested object
// ---------------------------------------------------------------------------

function deepSet(obj: any, dotPath: string, value: any): void {
  const keys = dotPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current) || typeof current[keys[i]] !== "object") {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// resolveEnvRefs — replace ${env:VAR_NAME} with process.env values
// ---------------------------------------------------------------------------

function resolveEnvRefs(obj: any): any {
  if (typeof obj === "string") {
    // Full replacement: "${env:VAR}" → process.env.VAR (preserves non-string types via raw value)
    const fullMatch = obj.match(/^\$\{env:([^}]+)\}$/);
    if (fullMatch) {
      const value = process.env[fullMatch[1]];
      if (value === undefined) {
        console.warn(`[config] Warning: env var "${fullMatch[1]}" is not set — leaving as "${obj}"`);
        return obj;
      }
      return value;
    }
    // Partial replacement: "prefix_${env:VAR}_suffix" → "prefix_value_suffix"
    return obj.replace(/\$\{env:([^}]+)\}/g, (_match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        console.warn(`[config] Warning: env var "${varName}" is not set — leaving reference in string`);
        return _match;
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvRefs(item));
  }
  if (obj !== null && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvRefs(value);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Agent-centric path helpers
// ---------------------------------------------------------------------------

/** Session directory for user ↔ agent conversations */

/** User session directory: sessions/{userId}/ */
export function userSessionDir(userId: string): string {
  return path.join(WORKSPACE_DIR, "sessions", userId);
}

/** Per-agent session directory: sessions/{userId}/{agentId}/ */
export function agentSessionDir(userId: string, agentId: string): string {
  return path.join(WORKSPACE_DIR, "sessions", userId, agentId);
}

/** Per-agent session file: sessions/{userId}/{agentId}/session.jsonl */
export function agentSessionPath(userId: string, agentId: string): string {
  return path.join(agentSessionDir(userId, agentId), "session.jsonl");
}

/** Per-agent session archives: sessions/{userId}/{agentId}/archives/ */
export function agentSessionArchiveDir(userId: string, agentId: string): string {
  return path.join(agentSessionDir(userId, agentId), "archives");
}

/** Memory directory for an agent */
export function agentMemoryDir(agentId: string): string {
  return path.join(WORKSPACE_DIR, "agents", agentId, "memory");
}

/** Workflow session for a manager agent */
export function agentWorkflowSessionPath(agentId: string, name: string): string {
  return path.join(WORKSPACE_DIR, "agents", agentId, "sessions", "workflows", `${name}.jsonl`);
}

/** Task session for an agent executing a delegated task */
export function agentTaskSessionPath(agentId: string, taskId: string): string {
  return path.join(WORKSPACE_DIR, "agents", agentId, "sessions", "tasks", `${taskId}.jsonl`);
}

/** Job session for a scheduled job */
export function agentJobSessionPath(agentId: string, jobId: string): string {
  return path.join(WORKSPACE_DIR, "agents", agentId, "sessions", "jobs", `${jobId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Team helpers
// ---------------------------------------------------------------------------

/** Returns the team folder path for a given team name */
export function getTeamFolder(teamName: string): string {
  return path.join(WORKSPACE_DIR, "teams", teamName);
}

/** Returns all teams this agent manages or belongs to */
export function getTeamsForAgent(agentId: string): { name: string; role: "manager" | "member" }[] {
  const result: { name: string; role: "manager" | "member" }[] = [];
  for (const [name, team] of Object.entries(config.teams)) {
    if (team.manager === agentId) {
      result.push({ name, role: "manager" });
    } else if (team.members.includes(agentId)) {
      result.push({ name, role: "member" });
    }
  }
  return result;
}

/** Checks if fromAgent can delegate to toAgent (direct report in any team fromAgent manages) */
export function canDelegateTo(fromAgent: string, toAgent: string): boolean {
  for (const team of Object.values(config.teams)) {
    if (team.manager === fromAgent && team.members.includes(toAgent)) {
      return true;
    }
  }
  return false;
}

/** Returns the team members with descriptions for a manager agent */
export function getTeamMembers(agentId: string): { id: string; description: string }[] {
  const members: { id: string; description: string }[] = [];
  for (const team of Object.values(config.teams)) {
    if (team.manager === agentId) {
      for (const memberId of team.members) {
        const agent = config.agents[memberId];
        members.push({
          id: memberId,
          description: agent?.description || "No description",
        });
      }
    }
  }
  return members;
}

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of permitted tool names for an agent based on its role.
 * Returns null if agent has no role — meaning no filtering (all tools available).
 * Task context tools (log_progress, complete_task) are added by the caller when needed.
 */
export function getAgentPermissions(agentId: string): string[] | null {
  const agent = config.agents[agentId];
  if (!agent?.role) return null; // No role = all tools (backwards compatible)

  const permissions = config.roles[agent.role];
  if (!permissions) {
    console.warn(`[roles] Agent "${agentId}" has role "${agent.role}" but no matching role definition — allowing all tools`);
    return null;
  }

  return permissions;
}

// ---------------------------------------------------------------------------
// Team validation — run after config is loaded
// ---------------------------------------------------------------------------

export function validateTeams(): void {
  const allAgentIds = Object.keys(config.agents);

  for (const [teamName, team] of Object.entries(config.teams)) {
    // Check manager exists
    if (!allAgentIds.includes(team.manager)) {
      console.warn(`[teams] Warning: team "${teamName}" manager "${team.manager}" is not a configured agent`);
    }

    // Check members exist
    for (const memberId of team.members) {
      if (!allAgentIds.includes(memberId)) {
        console.warn(`[teams] Warning: team "${teamName}" member "${memberId}" is not a configured agent`);
      }
    }

    // Check manager is not also a member of their own team
    if (team.members.includes(team.manager)) {
      console.warn(`[teams] Warning: team "${teamName}" manager "${team.manager}" is also listed as a member`);
    }
  }

  // Check for circular management (A manages B manages A)
  for (const [teamName, team] of Object.entries(config.teams)) {
    for (const memberId of team.members) {
      // Is this member a manager of a team that contains the current manager?
      for (const [otherName, otherTeam] of Object.entries(config.teams)) {
        if (otherTeam.manager === memberId && otherTeam.members.includes(team.manager)) {
          console.warn(
            `[teams] Warning: circular management detected — ` +
            `"${team.manager}" manages "${memberId}" in team "${teamName}", ` +
            `but "${memberId}" manages "${team.manager}" in team "${otherName}"`
          );
        }
      }
    }
  }

  // Validate roles — warn if agent references unknown role
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (agent.role && !config.roles[agent.role]) {
      console.warn(`[roles] Warning: agent "${agentId}" has role "${agent.role}" but no matching role definition in roles.*`);
    }
  }

  // Startup log — teams
  for (const [teamName, team] of Object.entries(config.teams)) {
    console.log(`[teams] ${teamName}: ${team.manager} → ${team.members.join(", ")}`);
  }

  // Startup log — roles
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (agent.role) {
      const perms = config.roles[agent.role];
      console.log(`[roles] ${agentId}: ${agent.role} (${perms ? perms.length + " tools" : "unknown role"})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Templates — read from src/templates/ at runtime
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = path.join(import.meta.dirname, "templates");

// Bundled skills shipped with the package.
// Dev (tsx): import.meta.dirname = src/ → src/skills/
// Prod (tsup): import.meta.dirname = dist/ → dist/skills/
export const BUNDLED_SKILLS_DIR = path.join(import.meta.dirname, "skills");

function loadTemplate(filename: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, filename), "utf-8");
}

// ---------------------------------------------------------------------------
// loadConfig — boot sequence
// ---------------------------------------------------------------------------

/**
 * Ensures workspace root exists and generates missing template files.
 * Runs early during loadConfig() — before the full config is available.
 * All directory creation lives in workspace.ts initWorkspace().
 */
function ensureWorkspace(): void {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    console.log(`[boot] Created workspace at ${WORKSPACE_RAW}/`);
  }

  const configPath = path.join(WORKSPACE_DIR, "openwren.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, loadTemplate("openwren.json"), "utf-8");
    console.log(`[boot] Generated openwren.json — edit to customize your setup`);
  }

  const envPath = path.join(WORKSPACE_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, loadTemplate("env.template"), "utf-8");
    console.log(`[boot] Generated .env — add your API keys and tokens here`);
  }

  const securityPath = path.join(WORKSPACE_DIR, "security.json");
  if (!fs.existsSync(securityPath)) {
    fs.writeFileSync(securityPath, loadTemplate("security.json"), "utf-8");
    console.log(`[boot] Generated security.json — shell permissions and path protection`);
  }
}

/**
 * Parses openwren.json + .env into a complete Config object.
 * Pure function — no side effects beyond reading files.
 * Called by loadConfig() at boot and reloadConfig() on hot-reload.
 */
function parseConfig(): Config {
  // 1. Load workspace .env — single source of truth for all secrets
  const workspaceEnvPath = path.join(WORKSPACE_DIR, ".env");
  if (fs.existsSync(workspaceEnvPath)) {
    dotenv.config({ path: workspaceEnvPath, override: true, quiet: true });
  }

  // 2. Start with defaults
  const merged = JSON.parse(JSON.stringify(defaultConfig));

  // 3. Read and apply user overrides from openwren.json
  const configPath = path.join(WORKSPACE_DIR, "openwren.json");
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    const resolved = resolveEnvRefs(parsed);
    for (const [key, value] of Object.entries(resolved)) {
      deepSet(merged, key, value);
    }
  }

  // 4. Post-processing
  // Resolve timezone — fall back to system local if not set
  if (!merged.timezone) {
    merged.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  // Validate defaultModel format — must be "provider/model"
  const defaultModelStr = merged.defaultModel as string;
  if (!defaultModelStr || !defaultModelStr.includes("/")) {
    throw new Error(
      `config.defaultModel must be in "provider/model" format (e.g. "anthropic/claude-sonnet-4-6"), got: "${defaultModelStr}"`
    );
  }

  // Validate API keys — collect all provider names referenced in any model chain,
  // then verify each one that needs a key has one configured.
  const referencedProviders = new Set<string>();
  const allModelSpecs = [
    defaultModelStr,
    merged.defaultFallback ?? "",
    ...Object.values(merged.agents as Record<string, AgentConfig>).flatMap((a) =>
      [a.model ?? "", a.fallback ?? ""]
    ),
  ];
  for (const spec of allModelSpecs) {
    for (const segment of spec.split(",")) {
      const trimmed = segment.trim();
      const slash = trimmed.indexOf("/");
      if (slash > 0) {
        referencedProviders.add(trimmed.slice(0, slash));
      }
    }
  }
  // Ollama doesn't need an API key — skip it
  const keyProviders = ["anthropic", "openai", "google", "mistral", "groq", "xai", "deepseek"];
  for (const name of referencedProviders) {
    if (!keyProviders.includes(name)) continue;
    const providerConfig = (merged.providers as Record<string, { apiKey?: string }>)[name];
    if (!providerConfig?.apiKey) {
      const envVar = name === "anthropic" ? "ANTHROPIC_API_KEY" : `${name.toUpperCase()}_API_KEY`;
      throw new Error(
        `${name} API key not set. Add "providers.${name}.apiKey": "\${env:${envVar}}" to openwren.json and set ${envVar} in ~/.openwren/.env`
      );
    }
  }

  // Validate defaultAgent references a real agent
  if (!merged.agents[merged.defaultAgent]) {
    throw new Error(
      `config.defaultAgent "${merged.defaultAgent}" does not match any agent key`
    );
  }

  // Validate bindings reference real agents
  for (const [channelName, agentMap] of Object.entries(merged.bindings ?? {})) {
    for (const agentId of Object.keys(agentMap as Record<string, string>)) {
      if (!merged.agents[agentId]) {
        console.warn(
          `[config] Warning: bindings.${channelName}.${agentId} references unknown agent "${agentId}" — skipping`
        );
      }
    }
  }

  return { ...merged, workspaceDir: WORKSPACE_DIR };
}

function loadConfig(): Config {
  ensureWorkspace();
  const cfg = parseConfig();
  // Log timezone only at boot
  if (!cfg.timezone) {
    console.log(`[config] No timezone set — using system default`);
  }
  return cfg;
}

export const config = loadConfig();

/** Expose default config for the config editor. */
export function getDefaultConfig(): Omit<Config, "workspaceDir"> {
  return structuredClone(defaultConfig);
}

/**
 * Hot-reload config from disk. Mutates the existing `config` object in place
 * so all modules that import it see updates immediately. No restart needed.
 */
export function reloadConfig(): void {
  const fresh = parseConfig();
  Object.assign(config, fresh);
  console.log(`[config] Reloaded (${Object.keys(config.agents).length} agents)`);
}

// ---------------------------------------------------------------------------
// User resolution — maps channel sender IDs to user IDs
// ---------------------------------------------------------------------------

/**
 * Looks up which user owns the given sender ID on the given channel.
 * Returns the userId (config key) or null if no match (unauthorized).
 */
export function resolveUserId(
  channel: string,
  senderId: number | string
): string | null {
  for (const [userId, userConfig] of Object.entries(config.users)) {
    const channelId = userConfig.channelIds[channel];
    if (channelId !== undefined && channelId == senderId) {
      return userId;
    }
  }
  return null;
}
