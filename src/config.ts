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

export interface AgentConfig {
  name: string;
  triggerPrefix?: string;
  telegramToken?: string; // set in openwren.json, literal or via ${env:VAR}
}

export interface Config {
  defaultProvider: "anthropic" | "ollama";
  providers: {
    anthropic: {
      model: string;
      apiKey: string;
    };
    ollama: {
      model: string;
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
// ---------------------------------------------------------------------------

const defaultConfig: Omit<Config, "workspaceDir"> = {
  defaultProvider: "anthropic",
  providers: {
    anthropic: {
      model: "claude-sonnet-4-6",
      apiKey: "",
    },
    ollama: {
      model: "llama3.2",
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
// Config template generator — written on first run
// ---------------------------------------------------------------------------

const CONFIG_TEMPLATE = `// ─────────────────────────────────────────────────
// Open Wren — User Configuration
// ─────────────────────────────────────────────────
// Uncomment and edit any line to override defaults.
// Dot-notation keys map into the nested config:
//   "providers.anthropic.model" → config.providers.anthropic.model
//
// Secrets can reference env vars from ~/.openwren/.env:
//   "users.owner.channelIds.telegram": "\${env:OWNER_TELEGRAM_ID}"
//
// Supports JSON5: comments, trailing commas, unquoted keys.
// ─────────────────────────────────────────────────
{
  // --- Provider ---
  // "defaultProvider": "anthropic",
  // "providers.anthropic.model": "claude-sonnet-4-6",
  // "providers.anthropic.apiKey": "\${env:ANTHROPIC_API_KEY}",
  // "providers.ollama.model": "llama3.2",
  // "providers.ollama.baseUrl": "http://localhost:11434",

  // --- Agents ---
  // "agents.atlas.name": "Atlas",
  // "agents.einstein.name": "Einstein",
  // "agents.einstein.triggerPrefix": "/einstein",
  // "agents.wizard.name": "Wizard",
  // "agents.wizard.triggerPrefix": "/wizard",
  // "agents.personal_trainer.name": "Coach",
  // "agents.personal_trainer.triggerPrefix": "/coach",
  //
  // Telegram bot tokens (one per agent):
  // "agents.atlas.telegramToken": "\${env:TELEGRAM_BOT_TOKEN}",
  // "agents.einstein.telegramToken": "\${env:EINSTEIN_TELEGRAM_TOKEN}",

  // --- Users ---
  // "users.owner.displayName": "Your Name",
  // "users.owner.channelIds.telegram": "\${env:OWNER_TELEGRAM_ID}",

  // --- Channels ---
  // "channels.unauthorizedBehavior": "reject",
  // "channels.rateLimit.maxMessages": 20,
  // "channels.rateLimit.windowSeconds": 60,

  // --- Session ---
  // "timezone": "Europe/Stockholm",
  // "session.idleResetMinutes": 0,
  // "session.dailyResetTime": "",

  // --- Agent Loop ---
  // "agent.maxIterations": 10,
  // "agent.compaction.enabled": true,
  // "agent.compaction.contextWindowTokens": 25000,
  // "agent.compaction.thresholdPercent": 80,
}
`;

const ENV_TEMPLATE = `# ─────────────────────────────────────────────────
# Open Wren — Secrets
# ─────────────────────────────────────────────────
# Referenced from openwren.json via \${env:VAR_NAME}
# This file is never committed or shared.
# ─────────────────────────────────────────────────

# LLM provider
# ANTHROPIC_API_KEY=your_key_here

# Telegram bot token (main bot)
# TELEGRAM_BOT_TOKEN=your_token_here

# Your Telegram user ID (for authorization)
# OWNER_TELEGRAM_ID=123456789

# Dedicated agent bot tokens (optional)
# EINSTEIN_TELEGRAM_TOKEN=your_token_here
# WIZARD_TELEGRAM_TOKEN=your_token_here
# COACH_TELEGRAM_TOKEN=your_token_here
`;

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
    fs.writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");
    console.log(`[boot] Generated openwren.json — edit to customize your setup`);
  }

  const envPath = path.join(WORKSPACE_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, ENV_TEMPLATE, "utf-8");
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

  // Validate API key for selected provider
  if (merged.defaultProvider === "anthropic" && !merged.providers.anthropic.apiKey) {
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
