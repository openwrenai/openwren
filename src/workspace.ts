import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

/**
 * Ensures the workspace directory structure exists.
 * Called once at startup. Safe to call multiple times.
 *
 * ~/.bot-workspace/
 * ├── sessions/
 * ├── memory/
 * └── agents/
 *     └── main/
 *         └── soul.md   (created with default content if missing)
 */
export function initWorkspace(): void {
  const dirs = [
    config.workspaceDir,
    path.join(config.workspaceDir, "sessions"),
    path.join(config.workspaceDir, "memory"),
    path.join(config.workspaceDir, "agents"),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created workspace directory: ${dir}`);
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

## Memory

You have a persistent memory system that survives session resets and compaction.

- Use \`save_memory\` to store important facts, preferences, and context worth keeping across sessions.
- Use \`memory_search\` at the start of conversations that reference past context ("my project", "that thing we discussed", etc.).
- Memory files persist forever — session history does not.
- Prefix your memory keys with your name to avoid collisions with other agents (e.g. \`${agentId}-user-prefs\`, \`${agentId}-projects\`).

## Tools

You have access to tools for reading/writing files, running whitelisted shell commands, and searching memory.
Use them proactively when they help you give a better answer. Don't ask for permission to use a tool — just use it.

## Style

- Be concise. Skip preamble and filler phrases.
- If you don't know something, say so directly.
- If a task is ambiguous, ask one clarifying question — not five.
- Format responses with markdown when it aids readability (code blocks, lists, headers).
`;
}
