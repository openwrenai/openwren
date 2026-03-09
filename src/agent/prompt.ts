import * as fs from "fs";
import * as path from "path";
import { config, AgentConfig } from "../config";
import { buildSkillCatalog } from "./skills";

/**
 * Loads the soul file for the given agent from disk on every call.
 * Never cached — edits to soul.md take effect on the next message
 * without restarting the bot.
 *
 * Path is always: ~/.openwren/agents/{agentId}/soul.md
 * The agentId is the key in config, never stored in the soul file itself.
 */
/**
 * quiet=true suppresses per-skill log lines forwarded to buildSkillCatalog().
 * Pass true when called from a scheduled job runner.
 */
export function loadSystemPrompt(agentId: string, agentConfig: AgentConfig, quiet = false): string {
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

  // Build skill catalog for this agent
  const { catalog, autoloaded } = buildSkillCatalog(agentId, quiet);

  // Autoloaded skill bodies — injected directly, no load_skill call needed.
  // Each is wrapped with a clear header so the agent knows its name and origin.
  const autoloadedSection = autoloaded.length > 0
    ? "\n\n" + autoloaded
        .map(s => `---\n\n## Skill: ${s.name} (autoloaded)\n\n${s.body}`)
        .join("\n\n")
    : "";

  // Skill catalog — name + description only, agent calls load_skill for full instructions
  const catalogSection = catalog.length > 0
    ? [
        "",
        "",
        "---",
        "",
        "## Available Skills",
        "You have the following skills available. To activate a skill and get its full",
        "instructions, use the `load_skill` tool with the skill name.",
        "",
        ...catalog.map(e => `- **${e.name}**: ${e.description}`),
      ].join("\n")
    : "";

  // Runtime context — always appended last
  const runtimeContext = [
    ``,
    ``,
    `---`,
    `## Runtime`,
    `Your name is ${agentConfig.name}.`,
    `Today is ${new Date().toDateString()}.`,
  ].join("\n");

  return soul + autoloadedSection + catalogSection + runtimeContext;
}
