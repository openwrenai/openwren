/**
 * Tool categories — the hardcoded permission model.
 *
 * Tool access is derived from team membership, not stored in config:
 *   - Solo agent (no team) = BASE only
 *   - Team manager        = BASE + MANAGER (minus create_workflow if isDelegated)
 *   - Team member         = BASE + WORKER
 *
 * An agent can disable any subset of its candidate tools via
 * `agents.X.disabledTools: string[]` in config (subtractive only — the user
 * cannot grant tools outside the candidate set).
 *
 * Kept in its own module to avoid circular imports: callers in tools/ and
 * agent/skills.ts both need these helpers, but tools/index.ts also imports
 * from agent/skills.ts via tools/skills.ts.
 */

import { config, getTeamsForAgent } from "../config";

/** Tools available to every agent regardless of team membership. */
export const BASE_TOOL_NAMES = [
  "shell_exec",
  "list_shell_commands",
  "read_file",
  "write_file",
  "save_memory",
  "memory_search",
  "load_skill",
  "search_web",
  "fetch_url",
  "manage_schedule",
] as const;

/** Additional tools granted to team managers. */
export const MANAGER_TOOL_NAMES = [
  "create_workflow",
  "delegate_task",
  "query_workflow",
] as const;

/** Additional tools granted to team members (workers). */
export const WORKER_TOOL_NAMES = [
  "log_progress",
  "complete_task",
] as const;

export type ToolCategory = "base" | "manager" | "worker";

/** Returns the category a tool belongs to, or null if unknown. */
export function getToolCategory(name: string): ToolCategory | null {
  if ((BASE_TOOL_NAMES as readonly string[]).includes(name)) return "base";
  if ((MANAGER_TOOL_NAMES as readonly string[]).includes(name)) return "manager";
  if ((WORKER_TOOL_NAMES as readonly string[]).includes(name)) return "worker";
  return null;
}

/**
 * Derives an agent's role from its team memberships.
 * Any manager role wins — sub-managers (manager of one team, member of another)
 * get manager tools; completion is handled by the runner's auto-complete.
 */
export function getAgentRoleFromTeams(agentId: string): "manager" | "worker" | null {
  const teams = getTeamsForAgent(agentId);
  if (teams.length === 0) return null;
  if (teams.some((t) => t.role === "manager")) return "manager";
  return "worker";
}

/**
 * Returns the set of tool names an agent is eligible for BEFORE applying
 * `disabledTools`. This is what the Tools tab UI needs to render the full
 * list (locked manager/worker rows + togglable base rows).
 */
export function getAgentCandidateTools(agentId: string, isDelegated = false): string[] {
  const role = getAgentRoleFromTeams(agentId);
  const names: string[] = [...BASE_TOOL_NAMES];
  if (role === "manager") {
    for (const n of MANAGER_TOOL_NAMES) {
      // Sub-managers don't get create_workflow — they delegate within an existing workflow
      if (isDelegated && n === "create_workflow") continue;
      names.push(n);
    }
  } else if (role === "worker") {
    names.push(...WORKER_TOOL_NAMES);
  }
  return names;
}

/**
 * Returns the final tool name list for an agent at runtime — candidates
 * minus `disabledTools`.
 */
export function getAgentToolNames(agentId: string, isDelegated = false): string[] {
  const candidates = getAgentCandidateTools(agentId, isDelegated);
  const disabled = new Set(config.agents[agentId]?.disabledTools ?? []);
  return candidates.filter((n) => !disabled.has(n));
}
