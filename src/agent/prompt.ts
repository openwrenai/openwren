import * as fs from "fs";
import * as path from "path";
import { config, AgentConfig } from "../config";

/**
 * Loads the soul file for the given agent from disk on every call.
 * Never cached — edits to soul.md take effect on the next message
 * without restarting the bot.
 *
 * Path is always: ~/.openwren/agents/{agentId}/soul.md
 * The agentId is the key in config, never stored in the soul file itself.
 */
export function loadSystemPrompt(agentId: string, agentConfig: AgentConfig): string {
  const soulPath = path.join(
    config.workspaceDir,
    "agents",
    agentId,
    "soul.md"
  );

  if (!fs.existsSync(soulPath)) {
    throw new Error(
      `Soul file not found for agent "${agentId}" at ${soulPath}. ` +
      `Run initWorkspace() to create a default soul file.`
    );
  }

  const soul = fs.readFileSync(soulPath, "utf-8").trim();

  // Append a small runtime context block so the agent always knows who it is
  // and what session it's in — without hardcoding it into the soul file.
  const runtimeContext = [
    ``,
    `---`,
    `## Runtime`,
    `Your name is ${agentConfig.name}.`,
    `Today is ${new Date().toDateString()}.`,
  ].join("\n");

  return soul + runtimeContext;
}
