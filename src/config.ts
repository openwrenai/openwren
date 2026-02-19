import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

export interface AgentConfig {
  name: string;
  sessionPrefix: string;
  triggerPrefix?: string;
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
  telegram: {
    allowedUserIds: number[];
    unauthorizedBehavior: "silent" | "reject";  // silent = ignore, reject = reply "Unauthorized."
    rateLimit: {
      maxMessages: number;   // max messages allowed per sender in the window
      windowSeconds: number; // sliding window size in seconds
    };
  };
  session: {
    idleResetMinutes: number;
  };
  agent: {
    maxIterations: number;
    compaction: {
      enabled: boolean;
      contextWindowTokens: number; // total context window size for the model
      thresholdPercent: number;    // compact when usage exceeds this % of the window
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

  // Validate API key for selected provider
  if (raw.defaultProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in environment");
  }

  const workspaceDir = resolveWorkspace(raw.workspace ?? "~/.bot-workspace");

  return {
    ...raw,
    workspaceDir,
  };
}

export const config = loadConfig();
