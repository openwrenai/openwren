import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

/**
 * Ensures the workspace directory structure exists.
 * Called once at startup. Safe to call multiple times.
 *
 * ~/.openwren/
 * ├── sessions/
 * │   ├── {userId}/          ← one per user in config
 * │   │   ├── atlas/          ← one per agent
 * │   │   ├── einstein/
 * │   │   └── wizard/
 * │   └── local/             ← scratch/dev sessions
 * │       ├── main/
 * │       └── ...
 * ├── memory/
 * └── agents/
 *     └── atlas/
 *         └── soul.md
 */
export function initWorkspace(): void {
  const dirs = [
    config.workspaceDir,
    path.join(config.workspaceDir, "sessions"),
    path.join(config.workspaceDir, "memory"),
    path.join(config.workspaceDir, "agents"),
    path.join(config.workspaceDir, "skills"),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created workspace directory: ${dir}`);
    }
  }

  // Create session directories for each user + agent combo
  const userIds = [...Object.keys(config.users), "local"]; // "local" for scratch sessions
  const agentIds = Object.keys(config.agents);

  for (const userId of userIds) {
    for (const agentId of agentIds) {
      const sessionDir = path.join(config.workspaceDir, "sessions", userId, agentId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    }
  }

  // Ensure every configured agent has a soul.md
  for (const [agentId, agentConfig] of Object.entries(config.agents)) {
    const agentDir = path.join(config.workspaceDir, "agents", agentId);
    const soulPath = path.join(agentDir, "soul.md");

    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
      console.log(`Created agent directory: ${agentDir}`);
    }

    if (!fs.existsSync(soulPath)) {
      fs.writeFileSync(soulPath, defaultSoul(agentId, agentConfig.name));
      console.log(`Created default soul file: ${soulPath}`);
    }
  }
}

function defaultSoul(agentId: string, agentName: string): string {
  return `# Who You Are

You are ${agentName}, a personal AI assistant running locally on your owner's machine.
You are capable, direct, and thoughtful. You get things done without unnecessary filler.

Use your tools proactively when they help you give a better answer. Don't ask for permission to use a tool — just use it.

## Style

- Be concise. Skip preamble and filler phrases.
- If you don't know something, say so directly.
- If a task is ambiguous, ask one clarifying question — not five.
- Format responses with markdown when it aids readability (code blocks, lists, headers).
`;
}
