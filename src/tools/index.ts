import type { ToolDefinition } from "../providers";
import type { TaskContext } from "../agent/loop";
import { shellToolDefinition, listShellCommandsToolDefinition, executeShell, listShellCommands, parseCommand } from "./shell";
import { readFileToolDefinition, writeFileToolDefinition, readFile, writeFile } from "./filesystem";
import { saveMemoryToolDefinition, searchMemoryToolDefinition, saveMemory, searchMemory } from "./memory";
import { loadSkillToolDefinition, loadSkill } from "./skills";
import { searchWebToolDefinition, searchWeb } from "./search";
import { fetchUrlToolDefinition, fetchUrl } from "./fetch";
import { manageScheduleToolDefinition, manageSchedule } from "./schedule";
import {
  createWorkflowToolDefinition, delegateTaskToolDefinition, queryWorkflowToolDefinition,
  logProgressToolDefinition, completeTaskToolDefinition,
  createWorkflow, delegateTask, queryWorkflow, logProgress, completeTask,
} from "./orchestrate";
import { isApproved, permanentlyApprove } from "./approvals";
import { classifyCommand, getSecurity, isProtectedWrite } from "../security";
import { getAgentToolNames } from "./categories";

export {
  BASE_TOOL_NAMES,
  MANAGER_TOOL_NAMES,
  WORKER_TOOL_NAMES,
  getToolCategory,
  getAgentRoleFromTeams,
  getAgentCandidateTools,
  getAgentToolNames,
} from "./categories";
export type { ToolCategory } from "./categories";

// ---------------------------------------------------------------------------
// Confirm function type
// ---------------------------------------------------------------------------

/**
 * A callback the channel layer provides to ask the user YES/NO.
 * Returns: true = approved, false = denied, "always" = approved + permanently saved
 */
export type ConfirmFn = (command: string, reason?: string) => Promise<boolean | "always">;

// ---------------------------------------------------------------------------
// Approval timeout helper
// ---------------------------------------------------------------------------

/**
 * Wraps a confirm call with a configurable timeout from security.json.
 * Returns "timeout" if the user doesn't respond in time.
 * approvalTimeout: 0 = no timeout (wait forever).
 */
async function confirmWithTimeout(
  confirm: ConfirmFn,
  command: string,
  reason?: string
): Promise<boolean | "always" | "timeout"> {
  const timeoutSec = getSecurity().approvalTimeout;

  // 0 = no timeout
  if (timeoutSec <= 0) return confirm(command, reason);

  const timeoutMs = timeoutSec * 1000;
  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), timeoutMs)
  );

  return Promise.race([confirm(command, reason), timeoutPromise]);
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/** All available tools — keyed by name for permission filtering */
const allTools: ToolDefinition[] = [
  shellToolDefinition,
  listShellCommandsToolDefinition,
  readFileToolDefinition,
  writeFileToolDefinition,
  saveMemoryToolDefinition,
  searchMemoryToolDefinition,
  loadSkillToolDefinition,
  searchWebToolDefinition,
  fetchUrlToolDefinition,
  manageScheduleToolDefinition,
  createWorkflowToolDefinition,
  delegateTaskToolDefinition,
  queryWorkflowToolDefinition,
  logProgressToolDefinition,
  completeTaskToolDefinition,
];

const toolByName = new Map(allTools.map((t) => [t.name, t]));

/** Returns the ToolDefinition for a tool name, or undefined if unknown. */
export function getToolDefinitionByName(name: string): ToolDefinition | undefined {
  return toolByName.get(name);
}

/**
 * Returns tool definitions for a specific agent. Role (BASE/MANAGER/WORKER)
 * is derived from team membership, then `agents.X.disabledTools` is subtracted.
 */
export function getToolDefinitions(agentId: string, isDelegated = false): ToolDefinition[] {
  const names = getAgentToolNames(agentId, isDelegated);
  return names.map((n) => toolByName.get(n)).filter((t): t is ToolDefinition => !!t);
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

/**
 * Central dispatch for all tool calls. Every tool the agent invokes flows
 * through here — the ReAct loop in loop.ts calls this for each tool_use
 * block the LLM returns.
 *
 * @param name     - Tool name from the LLM response (e.g. "shell_exec", "read_file")
 * @param input    - Tool arguments parsed from the LLM response
 * @param agentId  - Which agent is calling this tool (used for permissions, sandboxing, memory scoping)
 * @param confirm      - Optional callback to ask the user YES/NO for privileged operations.
 *                       Provided by interactive channels (Telegram, Discord, WS).
 *                       Undefined for non-interactive contexts (scheduled jobs, tasks).
 * @param taskContext  - Optional context for the currently executing task. Set by the
 *                       orchestrator runner. Used by complete_task, log_progress (to know
 *                       which task to update), and delegate_task (mid-level managers use
 *                       workflowId and taskId for sub-task creation).
 * @returns            - Always a string — either the tool's output or an error message.
 *                       Never throws — errors are caught and returned as "[tool error] ..." strings
 *                       so the LLM can read the error and decide what to do next.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  agentId: string,
  confirm?: ConfirmFn,
  taskContext?: TaskContext,
): Promise<string> {
  try {
    switch (name) {
      case "shell_exec": {
        const command = input.command as string;
        const reason = input.reason as string | undefined;
        const { bin } = parseCommand(command);

        if (!bin) return "[shell error] Empty command.";

        // Three-tier classification
        const tier = classifyCommand(bin, agentId);

        if (tier === "blocked") {
          return `[shell error] Command "${bin}" is not allowed.`;
        }

        if (tier === "privileged") {
          // Check if already permanently approved for this agent
          if (isApproved(agentId, bin)) {
            console.log(`[approvals] Auto-approved "${bin}" for ${agentId}`);
          } else if (confirm) {
            // Interactive — ask user (with timeout)
            const answer = await confirmWithTimeout(confirm, command, reason);

            if (answer === "timeout") {
              return `[shell] Command timed out waiting for approval. Cancelled.`;
            }
            if (answer === false) {
              return `[shell] Command cancelled by user.`;
            }
            if (answer === "always") {
              permanentlyApprove(agentId, bin);
            }
          } else {
            // No confirm callback (scheduled job) — must be pre-approved
            return `[shell] Command "${bin}" requires pre-approval for scheduled execution. Add it to exec-approvals.json.`;
          }
        }

        // Safe commands and approved privileged commands execute here
        // validateCommand inside executeShell handles subcommand + protected path checks
        return await executeShell(command, agentId);
      }

      case "list_shell_commands":
        return listShellCommands(agentId);

      case "read_file":
        return await readFile(input.path as string, agentId);

      case "write_file": {
        const filePath = input.path as string;
        const content = input.content as string;

        // Check protected paths BEFORE prompting — no point asking the user
        // to approve a write that will be rejected anyway.
        const writeProtected = isProtectedWrite(filePath, agentId);
        if (writeProtected) {
          return `[write_file] Path is write-protected: ${writeProtected}`;
        }

        if (confirm) {
          const answer = await confirmWithTimeout(confirm, `write_file: ${filePath}`);
          if (answer === "timeout") {
            return `[write_file] Timed out waiting for approval. Cancelled.`;
          }
          if (answer === false) {
            return `[write_file] Cancelled by user.`;
          }
        }

        return await writeFile(filePath, content, agentId);
      }

      case "save_memory":
        return await saveMemory(agentId, input.key as string, input.content as string);

      case "memory_search":
        return await searchMemory(agentId, input.query as string);

      case "load_skill":
        return loadSkill(input.name as string, agentId);

      case "search_web":
        return await searchWeb(input.query as string, input.count as number | undefined);

      case "fetch_url":
        return await fetchUrl(input.url as string);

      case "manage_schedule":
        return await manageSchedule(input, agentId);

      case "create_workflow":
        return await createWorkflow(input, agentId);

      case "delegate_task":
        return await delegateTask(input, agentId, taskContext);

      case "query_workflow":
        return await queryWorkflow(input, agentId);

      case "log_progress":
        return await logProgress(input, agentId, taskContext);

      case "complete_task":
        return await completeTask(input, taskContext);

      default:
        return `[tool error] Unknown tool: "${name}"`;
    }
  } catch (err: unknown) {
    const e = err as Error;
    return `[tool error] ${name} threw an unexpected error: ${e.message}`;
  }
}
