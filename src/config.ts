import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

export interface UserConfig {
  displayName: string;
  channelIds: Record<string, number | string>; // e.g. { telegram: 8300966403, discord: "..." }
}

export interface AgentConfig {
  name: string;
  triggerPrefix?: string;
  telegramToken?: string; // resolved from env: {NAME}_TELEGRAM_TOKEN (e.g. EINSTEIN_TELEGRAM_TOKEN)
}

export interface Config {
  defaultProvider: "anthropic" | "ollama";
  providers: {
    anthropic: {
      model: string;
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
  workspace: string;
  workspaceDir: string; // resolved absolute path
}

function resolveWorkspace(raw: string): string {
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

function loadConfig(): Config {
  const configPath = path.join(__dirname, "..", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json not found at ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Validate required fields
  if (!raw.defaultProvider || !["anthropic", "ollama"].includes(raw.defaultProvider)) {
    throw new Error(`config.defaultProvider must be "anthropic" or "ollama"`);
  }
  if (!raw.providers || typeof raw.providers !== "object") {
    throw new Error("config.providers must be an object");
  }
  if (!raw.agents || typeof raw.agents !== "object") {
    throw new Error("config.agents must be an object");
  }
  if (!raw.defaultAgent || !raw.agents[raw.defaultAgent]) {
    throw new Error("config.defaultAgent must reference a valid agent key");
  }
  if (!raw.users || typeof raw.users !== "object") {
    throw new Error("config.users must be an object");
  }

  // Validate API key for selected provider
  if (raw.defaultProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in environment");
  }

  // Resolve per-agent Telegram tokens from env vars
  // Convention: {AGENT_NAME}_TELEGRAM_TOKEN (e.g. Einstein → EINSTEIN_TELEGRAM_TOKEN)
  for (const [id, agent] of Object.entries(raw.agents as Record<string, AgentConfig>)) {
    const envVar = `${agent.name.toUpperCase()}_TELEGRAM_TOKEN`;
    const token = process.env[envVar];
    if (token) {
      agent.telegramToken = token;
      console.log(`[config] Agent "${id}" has dedicated Telegram bot (${envVar})`);
    }
  }

  // Resolve timezone — fall back to system local if not set
  if (!raw.timezone) {
    raw.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`[config] No timezone set — using system default: ${raw.timezone}`);
  }

  const workspaceDir = resolveWorkspace(raw.workspace ?? "~/.bot-workspace");

  return {
    ...raw,
    workspaceDir,
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
