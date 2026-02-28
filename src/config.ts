import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as dotenv from "dotenv";
import JSON5 from "json5";

// ---------------------------------------------------------------------------
// Workspace path — hardcoded, not user-configurable
// ---------------------------------------------------------------------------

const WORKSPACE_RAW = "~/.openwren";

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
  triggerPrefix?: string;
  model?: string;    // "provider/model" override, e.g. "anthropic/claude-sonnet-4-6". Inherits defaultModel if unset.
  fallback?: string; // Comma-separated fallback chain, e.g. "anthropic/claude-haiku-3-5, ollama/llama3.2"
}

/** Top-level application config. Loaded once at boot from ~/.openwren/openwren.json merged over defaults. */
export interface Config {
  defaultModel: string;    // "provider/model" format, e.g. "anthropic/claude-sonnet-4-6"
  defaultFallback: string; // Comma-separated fallback chain, e.g. "anthropic/claude-haiku-3-5, ollama/llama3.2"
  providers: {
    anthropic: {
      apiKey: string;      // Credentials only — model selection moved to defaultModel / agents.*.model
    };
    ollama: {
      baseUrl: string;
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
  timezone: string;
  session: {
    idleResetMinutes: number;
    dailyResetTime: string; // "" = disabled, "04:00" = reset at 04:00
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
    ollama: {
      baseUrl: "http://localhost:11434",
    },
  },
  agents: {
    atlas: {
      name: "Atlas",
    },
    einstein: {
      name: "Einstein",
      triggerPrefix: "/einstein",
    },
    wizard: {
      name: "Wizard",
      triggerPrefix: "/wizard",
    },
    personal_trainer: {
      name: "Coach",
      triggerPrefix: "/coach",
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
  timezone: "",
  session: {
    idleResetMinutes: 0,
    dailyResetTime: "",
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
// Templates — read from src/templates/ at runtime
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = path.join(__dirname, "templates");

function loadTemplate(filename: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, filename), "utf-8");
}

// ---------------------------------------------------------------------------
// loadConfig — boot sequence
// ---------------------------------------------------------------------------

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
}

function loadConfig(): Config {
  // 1. Ensure workspace exists, generate templates if first run
  ensureWorkspace();

  // 2. Load workspace .env — single source of truth for all secrets
  const workspaceEnvPath = path.join(WORKSPACE_DIR, ".env");
  if (fs.existsSync(workspaceEnvPath)) {
    dotenv.config({ path: workspaceEnvPath, override: true, quiet: true });
  }

  // 3. Start with defaults
  const merged = JSON.parse(JSON.stringify(defaultConfig));

  // 4. Read and apply user overrides from openwren.json
  const configPath = path.join(WORKSPACE_DIR, "openwren.json");
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    const resolved = resolveEnvRefs(parsed);
    for (const [key, value] of Object.entries(resolved)) {
      deepSet(merged, key, value);
    }
  }

  // 5. Post-processing
  // Resolve timezone — fall back to system local if not set
  if (!merged.timezone) {
    merged.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`[config] No timezone set — using system default: ${merged.timezone}`);
  }

  // Validate defaultModel format — must be "provider/model"
  const defaultModelStr = merged.defaultModel as string;
  if (!defaultModelStr || !defaultModelStr.includes("/")) {
    throw new Error(
      `config.defaultModel must be in "provider/model" format (e.g. "anthropic/claude-sonnet-4-6"), got: "${defaultModelStr}"`
    );
  }

  // Validate API key if any model in the chain uses Anthropic
  const usesAnthropic =
    defaultModelStr.startsWith("anthropic/") ||
    (merged.defaultFallback ?? "").includes("anthropic/");
  if (usesAnthropic && !merged.providers.anthropic.apiKey) {
    throw new Error(
      'Anthropic API key not set. Add "providers.anthropic.apiKey": "${env:ANTHROPIC_API_KEY}" to openwren.json and set ANTHROPIC_API_KEY in ~/.openwren/.env'
    );
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

  return {
    ...merged,
    workspaceDir: WORKSPACE_DIR,
  };
}

export const config = loadConfig();

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
