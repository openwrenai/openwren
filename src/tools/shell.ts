import { execFile } from "child_process";
import { promisify } from "util";
import type { ToolDefinition } from "../providers";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

const ALLOWED_COMMANDS = new Set([
  "ls", "find", "cat", "head", "tail", "grep", "wc", "awk", "sed",
  "sort", "uniq", "jq",
  "mkdir", "touch", "cp", "mv",
  "git",
  "npm", "npx", "node",
  "curl", "ping", "df", "du", "ps", "lsof",
  "date", "echo", "which",
]);

// Commands that are allowed but require a confirmation step before execution.
// The confirmation flow lives in the channel layer (telegram.ts), not here.
// This set is exported so the channel layer can check it.
export const DESTRUCTIVE_COMMANDS = new Set(["mv", "cp", "mkdir", "touch"]);

// curl is only allowed as GET (no -X POST, -d, --data, --request POST, etc.)
const CURL_BLOCKED_FLAGS = /(-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE)|-d\s|--data\s|--data-raw\s)/i;

function parseCommand(command: string): { bin: string; args: string[] } {
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

function validateCommand(command: string): string | null {
  const { bin, args } = parseCommand(command);

  if (!bin) return "Empty command.";

  // For git, npm, npx — only allow specific subcommands
  if (bin === "git") {
    const sub = args[0];
    const allowedGit = new Set(["status", "log", "diff", "pull", "add", "commit", "push"]);
    if (!sub || !allowedGit.has(sub)) {
      return `git subcommand "${sub}" is not allowed. Allowed: ${[...allowedGit].join(", ")}`;
    }
    return null;
  }

  if (bin === "npm") {
    const sub = args[0];
    if (sub !== "run") {
      return `npm subcommand "${sub}" is not allowed. Only "npm run" is allowed.`;
    }
    return null;
  }

  if (bin === "curl") {
    if (CURL_BLOCKED_FLAGS.test(command)) {
      return "curl is only allowed for GET requests. POST/PUT/PATCH/DELETE are blocked.";
    }
    return null;
  }

  if (!ALLOWED_COMMANDS.has(bin)) {
    return `Command "${bin}" is not in the whitelist.`;
  }

  return null; // valid
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeShell(command: string): Promise<string> {
  const error = validateCommand(command);
  if (error) {
    return `[shell error] ${error}`;
  }

  const { bin, args } = parseCommand(command);

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
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
// Tool definition
// ---------------------------------------------------------------------------

export const shellToolDefinition: ToolDefinition = {
  name: "shell_exec",
  description:
    "Run a whitelisted shell command on the local machine. " +
    "Allowed commands: ls, find, cat, head, tail, grep, wc, awk, sed, sort, uniq, jq, " +
    "mkdir, touch, cp, mv, git (status/log/diff/pull/add/commit/push), " +
    "npm run, npx, node, curl (GET only), ping, df, du, ps, lsof, date, echo, which. " +
    "Destructive commands (mv, cp, mkdir, touch) require user confirmation before execution.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The full shell command to run, e.g. \"ls -la /tmp\" or \"git status\"",
      },
    },
    required: ["command"],
  },
};
