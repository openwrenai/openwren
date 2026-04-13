import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

/**
 * Ensures the workspace directory structure exists.
 * Called once at startup. Safe to call multiple times.
 *
 * ~/.openwren/
 * ├── data/                   ← SQLite databases
 * ├── teams/                  ← shared team folders
 * ├── sessions/               ← user-facing conversations (user-scoped)
 * │   └── {userId}/
 * │       ├── sessions.json   ← index of WebUI sessions
 * │       ├── main.jsonl      ← default session — all channels hit this
 * │       ├── {uuid}.jsonl    ← WebUI sessions
 * │       └── archives/
 * ├── schedules/
 * │   ├── jobs.json
 * │   └── runs/
 * └── agents/
 *     └── {agentId}/
 *         ├── soul.md
 *         ├── workflow.md     ← optional, for managers
 *         ├── heartbeat.md   ← optional
 *         ├── workspace/
 *         ├── memory/
 *         ├── skills/
 *         └── sessions/       ← system sessions only (tasks, jobs)
 *             ├── jobs/
 *             └── tasks/
 */
export function initWorkspace(): void {
  const dirs = [
    config.workspaceDir,
    path.join(config.workspaceDir, "data"),
    path.join(config.workspaceDir, "teams"),
    path.join(config.workspaceDir, "sessions"),
    path.join(config.workspaceDir, "agents"),
    path.join(config.workspaceDir, "skills"),
    path.join(config.workspaceDir, "schedules"),
    path.join(config.workspaceDir, "schedules", "runs"),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created workspace directory: ${dir}`);
    }
  }

  // Create per-user, per-agent session directories
  const userIds = [...Object.keys(config.users), "local"];
  for (const userId of userIds) {
    for (const agentId of Object.keys(config.agents)) {
      const agentDir = path.join(config.workspaceDir, "sessions", userId, agentId);
      const archiveDir = path.join(agentDir, "archives");
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }
    }
  }

  // Ensure every configured agent has a soul.md and agent-centric directory structure
  for (const [agentId, agentConfig] of Object.entries(config.agents)) {
    const agentDir = path.join(config.workspaceDir, "agents", agentId);
    const soulPath = path.join(agentDir, "soul.md");

    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
      console.log(`Created agent directory: ${agentDir}`);
    }

    // Create agent subdirectories — system sessions only (tasks, jobs)
    const subdirs = [
      path.join(agentDir, "memory"),
      path.join(agentDir, "workspace"),
      path.join(agentDir, "sessions", "jobs"),
      path.join(agentDir, "sessions", "tasks"),
    ];
    for (const dir of subdirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    if (!fs.existsSync(soulPath)) {
      fs.writeFileSync(soulPath, defaultSoul(agentId, agentConfig.name));
      console.log(`Created default soul file: ${soulPath}`);
    }
  }

  // Create team directories
  for (const teamName of Object.keys(config.teams)) {
    const teamDir = path.join(config.workspaceDir, "teams", teamName);
    if (!fs.existsSync(teamDir)) {
      fs.mkdirSync(teamDir, { recursive: true });
    }
  }
}

export function defaultSoul(agentId: string, agentName: string): string {
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
