import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import type { ToolDefinition } from "../providers";
import { config } from "../config";
import {
  classifyCommand,
  validateSubcommand,
  checkArgsForProtectedPaths,
  getSecurity,
} from "../security";
import { isApproved } from "./approvals";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

export function parseCommand(command: string): { bin: string; args: string[] } {
  // Simple shell-style split — handles quoted strings
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const char of command) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);

  const [bin, ...args] = parts;
  return { bin, args };
}

// ---------------------------------------------------------------------------
// Validation — delegates entirely to security.ts
// ---------------------------------------------------------------------------

/**
 * Validates a command against the security policy.
 * Returns an error string if blocked, or null if allowed.
 */
export function validateCommand(command: string, agentId: string): string | null {
  const { bin, args } = parseCommand(command);

  if (!bin) return "Empty command.";

  // 1. Tier check — is this binary allowed at all for this agent?
  const tier = classifyCommand(bin, agentId);
  if (tier === "blocked") {
    return `Command "${bin}" is not allowed.`;
  }

  // 2. Subcommand restrictions (e.g. git only allows status/log/diff/...)
  const subError = validateSubcommand(bin, args);
  if (subError) return subError;

  // 3. Protected path scan — catches `cat .env`, `grep foo soul.md`, etc.
  const protectedMatch = checkArgsForProtectedPaths(args);
  if (protectedMatch) {
    return `Command references protected path: ${protectedMatch}`;
  }

  return null; // valid
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeShell(command: string, agentId: string): Promise<string> {
  const error = validateCommand(command, agentId);
  if (error) {
    return `[shell error] ${error}`;
  }

  const { bin, args } = parseCommand(command);

  try {
    const agentWorkspace = path.join(config.workspaceDir, "agents", agentId, "workspace");
    if (!fs.existsSync(agentWorkspace)) {
      fs.mkdirSync(agentWorkspace, { recursive: true });
    }
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: agentWorkspace,
      timeout: 15_000, // 15 seconds max
      maxBuffer: 1024 * 512, // 512 KB output cap
    });
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = e.stderr || e.stdout || e.message || String(err);
    return `[shell error] ${detail}`;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const shellToolDefinition: ToolDefinition = {
  name: "shell_exec",
  description:
    "Run a shell command on the local machine. " +
    "Commands are classified as safe (run silently), privileged (require confirmation), or blocked. " +
    "Use list_shell_commands to see what's available for your agent. " +
    "Always provide a reason explaining why you need to run the command.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The full shell command to run, e.g. \"ls -la /tmp\" or \"git status\"",
      },
      reason: {
        type: "string",
        description: "Brief explanation of why this command needs to run. Shown to the user in the confirmation prompt.",
      },
    },
    required: ["command"],
  },
};

export const listShellCommandsToolDefinition: ToolDefinition = {
  name: "list_shell_commands",
  description:
    "List all shell commands available for shell_exec and their permission level. " +
    "Call this when you need to check what commands are allowed.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

// ---------------------------------------------------------------------------
// List commands — reflects agent's actual permissions from security.json
// ---------------------------------------------------------------------------

export function listShellCommands(agentId: string): string {
  const sec = getSecurity();
  const agentMode = sec.agents[agentId]?.mode ?? sec.mode;

  if (agentMode === "deny") {
    return "Shell access is disabled for this agent.";
  }

  if (agentMode === "full") {
    return "Unrestricted shell access. All commands allowed.";
  }

  // Allowlist mode
  const safe = [...sec.tiers.safe].sort();
  const privileged = [...sec.tiers.privileged].sort();

  // Check which privileged binaries are already approved
  const approved = privileged.filter((bin) => isApproved(agentId, bin));
  const needsConfirmation = privileged.filter((bin) => !isApproved(agentId, bin));

  const lines: string[] = [
    "Safe (run silently): " + safe.join(", "),
    "",
  ];

  if (approved.length > 0) {
    lines.push("Privileged (pre-approved): " + approved.join(", "));
  }
  if (needsConfirmation.length > 0) {
    lines.push("Privileged (require confirmation): " + needsConfirmation.join(", "));
  }

  // Subcommand restrictions
  const subKeys = Object.keys(sec.subcommands);
  if (subKeys.length > 0) {
    lines.push("");
    lines.push("Subcommand restrictions:");
    for (const bin of subKeys) {
      lines.push(`  ${bin}: ${sec.subcommands[bin].join(", ")}`);
    }
  }

  return lines.join("\n");
}
