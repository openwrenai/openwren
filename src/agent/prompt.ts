import * as fs from "fs";
import * as path from "path";
import { config, AgentConfig, getTeamMembers } from "../config";
import { buildSkillCatalog } from "./skills";
import type { TaskContext } from "./loop";

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
export function loadSystemPrompt(agentId: string, agentConfig: AgentConfig, quiet = false, taskContext?: TaskContext): string {
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

  // Load workflow.md if present (manager agents)
  const workflowPath = path.join(
    config.workspaceDir,
    "agents",
    agentId,
    "workflow.md"
  );
  const workflowSection = fs.existsSync(workflowPath)
    ? "\n\n---\n\n## Workflow\n\n" + fs.readFileSync(workflowPath, "utf-8").trim()
    : "";

  // Inject team info for manager agents
  const teamMembers = getTeamMembers(agentId);
  const teamSection = teamMembers.length > 0
    ? "\n\n---\n\n## Your Team\n\n" +
      teamMembers.map(m => `- **${m.id}**: ${m.description}`).join("\n")
    : "";

  // Build skill catalog for this agent
  const { catalog, autoloaded } = buildSkillCatalog(agentId, quiet, !!taskContext);

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

  // Inject task context for agents running inside a delegated task
  const taskContextSection = taskContext
    ? [
        "",
        "",
        "---",
        "",
        "## Task Context",
        "",
        `You are executing **task ${taskContext.taskId}** in **workflow ${taskContext.workflowId}**.`,
        `Task slug: ${taskContext.slug}`,
        `Assigned by: ${taskContext.assignedBy}`,
        `Use workflow ID **${taskContext.workflowId}** when calling delegate_task.`,
      ].join("\n")
    : "";

  return soul + workflowSection + teamSection + taskContextSection + autoloadedSection + catalogSection;
}
