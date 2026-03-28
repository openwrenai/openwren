import * as fs from "fs";
import * as path from "path";
import JSON5 from "json5";
import { config } from "./config";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export type SecurityMode = "deny" | "allowlist" | "full";

export interface SecurityConfig {
  mode: SecurityMode;
  tiers: {
    safe: string[];
    privileged: string[];
  };
  subcommands: Record<string, string[]>; // e.g. { git: ["status", "log", ...], npm: ["run"] }
  paths: {
    protectedWrite: string[];
    protectedRead: string[];
    allowReadOutside: string[];
  };
  agents: Record<string, {
    mode?: SecurityMode;
    paths?: { protectedWrite?: string[] };
  }>; // per-agent overrides
  scheduler: {
    requirePreApproval: boolean;
  };
  approvalTimeout: number;
}

// ---------------------------------------------------------------------------
// Defaults — always valid, matches src/templates/security.json
// ---------------------------------------------------------------------------

const defaultSecurity: SecurityConfig = {
  mode: "allowlist",
  tiers: {
    safe: ["ls", "find", "cat", "head", "tail", "grep", "wc", "sort", "uniq", "jq", "df", "du", "ps", "lsof", "date", "echo", "which"],
    privileged: ["git", "npm", "npx", "node", "curl", "ping", "mv", "cp", "mkdir", "touch", "agent-browser"],
  },
  subcommands: {
    git: ["add", "branch", "checkout", "clone", "commit", "diff", "fetch", "log", "merge", "pull", "push", "remote", "stash", "status", "tag"],
    npm: ["ci", "info", "install", "list", "ls", "outdated", "run", "test", "view"],
  },
  paths: {
    protectedWrite: ["agents/*/soul.md", "openwren.json", "security.json", ".env", "exec-approvals.json"],
    protectedRead: [".env"],
    allowReadOutside: [],
  },
  agents: {},
  scheduler: {
    requirePreApproval: true,
  },
  approvalTimeout: 300,
};

// ---------------------------------------------------------------------------
// deepSet — inject a dot-notation key into a nested object
// (same as config.ts — duplicated to keep security.ts self-contained)
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
// Simple glob matcher — supports * (any non-slash segment) in patterns
// ---------------------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (except *)
    .replace(/\*/g, "[^/]+");              // * matches one path segment (no slashes)
  return new RegExp(`^${escaped}$`);
}

function matchesAnyGlob(filePath: string, patterns: string[]): string | null {
  // Normalize: strip leading ./ or /
  const normalized = filePath.replace(/^\.\//, "").replace(/^\//, "");
  for (const pattern of patterns) {
    if (globToRegex(pattern).test(normalized)) {
      return pattern;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Loader — mirrors config.ts pattern
// ---------------------------------------------------------------------------

let cached: SecurityConfig | null = null;

function loadSecurity(): SecurityConfig {
  // Start with defaults (deep copy)
  const merged = JSON.parse(JSON.stringify(defaultSecurity));

  // Read user overrides from ~/.openwren/security.json
  const securityPath = path.join(config.workspaceDir, "security.json");
  if (fs.existsSync(securityPath)) {
    try {
      const raw = fs.readFileSync(securityPath, "utf-8");
      const parsed = JSON5.parse(raw);
      for (const [key, value] of Object.entries(parsed)) {
        deepSet(merged, key, value);
      }
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`[security] Failed to parse security.json: ${e.message} — using defaults`);
    }
  } else {
    console.log("[security] No security.json found — using defaults");
  }

  // Startup logging
  const sec = merged as SecurityConfig;
  console.log(`[security] Mode: ${sec.mode}`);
  console.log(`[security] Safe: ${sec.tiers.safe.length} commands | Privileged: ${sec.tiers.privileged.length} commands`);

  // Log per-agent overrides, and agents that inherit
  const agentIds = Object.keys(config.agents);
  for (const agentId of agentIds) {
    const agentSec = sec.agents[agentId];
    const modeOverride = agentSec?.mode;
    if (modeOverride) {
      const label = modeOverride === "deny" ? "deny (shell disabled)" : modeOverride;
      console.log(`[security] ${agentId}: ${label}`);
    }

    // Log per-agent path overrides
    if (agentSec?.paths?.protectedWrite !== undefined) {
      const count = agentSec.paths.protectedWrite.length;
      console.log(`[security] ${agentId}: custom protectedWrite (${count} patterns)`);
    }
  }

  return sec;
}

// ---------------------------------------------------------------------------
// Public API — cached access
// ---------------------------------------------------------------------------

/** Returns the cached security config. Lazy-loads on first call. */
export function getSecurity(): SecurityConfig {
  if (!cached) {
    cached = loadSecurity();
  }
  return cached;
}

/** Clears cache, forces re-read from disk on next getSecurity() call. */
export function reloadSecurity(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolves effective mode for an agent: per-agent override → global → "allowlist" */
function getAgentMode(agentId: string): SecurityMode {
  const sec = getSecurity();
  return sec.agents[agentId]?.mode ?? sec.mode;
}

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

/**
 * Classifies a command binary for a given agent.
 * Returns "safe" (run silently), "privileged" (needs confirmation), or "blocked" (denied).
 */
export function classifyCommand(bin: string, agentId: string): "safe" | "privileged" | "blocked" {
  const mode = getAgentMode(agentId);

  // Mode overrides
  if (mode === "deny") return "blocked";
  if (mode === "full") return "safe";

  // Allowlist mode — check tiers
  const sec = getSecurity();
  if (sec.tiers.safe.includes(bin)) return "safe";
  if (sec.tiers.privileged.includes(bin)) return "privileged";

  // Not in any tier → blocked
  return "blocked";
}

// ---------------------------------------------------------------------------
// Subcommand validation
// ---------------------------------------------------------------------------

/**
 * Validates that a subcommand is allowed for the given binary.
 * Returns an error string if blocked, or null if allowed.
 *
 * If no subcommand restrictions exist for the binary, all subcommands are allowed.
 */
export function validateSubcommand(bin: string, args: string[]): string | null {
  const sec = getSecurity();
  const allowed = sec.subcommands[bin];

  // No restrictions for this binary — allow everything
  if (!allowed) return null;

  // Extract subcommand (first non-flag argument)
  const subcommand = args.find((a) => !a.startsWith("-"));
  if (!subcommand) {
    // No subcommand provided (e.g. bare `git`) — allow, the binary itself will handle it
    return null;
  }

  if (!allowed.includes(subcommand)) {
    return `Subcommand "${bin} ${subcommand}" is not allowed. Permitted: ${allowed.join(", ")}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Protected path checks — for filesystem tools
// ---------------------------------------------------------------------------

/** Returns the matching pattern if filePath is write-protected, or null.
 *  If the agent has a per-agent protectedWrite override, uses that instead of global. */
export function isProtectedWrite(filePath: string, agentId?: string): string | null {
  const sec = getSecurity();

  // Per-agent override: if this agent has its own protectedWrite list, use it exclusively
  if (agentId) {
    const agentPaths = sec.agents[agentId]?.paths?.protectedWrite;
    if (agentPaths !== undefined) {
      return matchesAnyGlob(filePath, agentPaths);
    }
  }

  // Fall back to global
  return matchesAnyGlob(filePath, sec.paths.protectedWrite);
}

/** Returns the matching pattern if filePath is read-protected, or null. */
export function isProtectedRead(filePath: string): string | null {
  const sec = getSecurity();
  return matchesAnyGlob(filePath, sec.paths.protectedRead);
}

/** Returns true if the absolute path is allowed for outside-workspace reads. */
export function isAllowedOutsidePath(filePath: string): boolean {
  const sec = getSecurity();
  // Check if the path starts with any allowed outside path
  return sec.paths.allowReadOutside.some(
    (allowed) => filePath === allowed || filePath.startsWith(allowed + path.sep)
  );
}

// ---------------------------------------------------------------------------
// Shell argument scanning — catches protected paths in command args
// ---------------------------------------------------------------------------

/**
 * Scans shell command arguments for references to protected paths.
 * Returns the matching protected pattern or null.
 *
 * Catches obvious cases like `cat .env`, `grep foo .env`, `cp soul.md /tmp/`.
 * Not bulletproof (can't catch `cat $(echo .env)`) but prevents accidental access.
 */
export function checkArgsForProtectedPaths(args: string[]): string | null {
  const sec = getSecurity();
  const allProtected = [...sec.paths.protectedWrite, ...sec.paths.protectedRead];

  for (const arg of args) {
    // Skip flags
    if (arg.startsWith("-")) continue;

    // Check against all protected patterns
    const match = matchesAnyGlob(arg, allProtected);
    if (match) return match;
  }

  return null;
}
