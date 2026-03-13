import type { ToolDefinition } from "../providers";
import { shellToolDefinition, listShellCommandsToolDefinition, executeShell, listShellCommands, parseCommand } from "./shell";
import { readFileToolDefinition, writeFileToolDefinition, readFile, writeFile } from "./filesystem";
import { saveMemoryToolDefinition, searchMemoryToolDefinition, saveMemory, searchMemory } from "./memory";
import { loadSkillToolDefinition, loadSkill } from "./skills";
import { searchWebToolDefinition, searchWeb } from "./search";
import { fetchUrlToolDefinition, fetchUrl } from "./fetch";
import { manageScheduleToolDefinition, manageSchedule } from "./schedule";
import { isApproved, permanentlyApprove } from "./approvals";
import { classifyCommand, getSecurity, isProtectedWrite } from "../security";

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

export function getToolDefinitions(): ToolDefinition[] {
  return [
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
  ];
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  agentId: string,
  confirm?: ConfirmFn
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
        return await saveMemory(input.key as string, input.content as string);

      case "memory_search":
        return await searchMemory(input.query as string);

      case "load_skill":
        return loadSkill(input.name as string, agentId);

      case "search_web":
        return await searchWeb(input.query as string, input.count as number | undefined);

      case "fetch_url":
        return await fetchUrl(input.url as string);

      case "manage_schedule":
        return await manageSchedule(input, agentId);

      default:
        return `[tool error] Unknown tool: "${name}"`;
    }
  } catch (err: unknown) {
    const e = err as Error;
    return `[tool error] ${name} threw an unexpected error: ${e.message}`;
  }
}
