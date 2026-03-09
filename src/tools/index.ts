import type { ToolDefinition } from "../providers";
import { shellToolDefinition, listShellCommandsToolDefinition, executeShell, listShellCommands, DESTRUCTIVE_COMMANDS } from "./shell";
import { readFileToolDefinition, writeFileToolDefinition, readFile, writeFile } from "./filesystem";
import { saveMemoryToolDefinition, searchMemoryToolDefinition, saveMemory, searchMemory } from "./memory";
import { loadSkillToolDefinition, loadSkill } from "./skills";
import { searchWebToolDefinition, searchWeb } from "./search";
import { fetchUrlToolDefinition, fetchUrl } from "./fetch";
import { manageScheduleToolDefinition, manageSchedule } from "./schedule";
import { isApproved, permanentlyApprove } from "./approvals";

// ---------------------------------------------------------------------------
// Confirm function type
// ---------------------------------------------------------------------------

/**
 * A callback the channel layer provides to ask the user YES/NO.
 * Returns: true = approved, false = denied, "always" = approved + permanently saved
 */
export type ConfirmFn = (command: string) => Promise<boolean | "always">;

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
        const bin = command.trim().split(/\s+/)[0];

        // Destructive commands require confirmation unless already approved
        if (DESTRUCTIVE_COMMANDS.has(bin)) {
          if (!isApproved(agentId, command)) {
            if (!confirm) {
              return `[shell] Command "${command}" requires confirmation but no confirm function is available.`;
            }

            const answer = await confirm(command);

            if (answer === false) {
              return `[shell] Command cancelled by user.`;
            }
            if (answer === "always") {
              permanentlyApprove(agentId, command);
            }
          } else {
            console.log(`[approvals] Auto-approved: ${command}`);
          }
        }

        return await executeShell(command);
      }

      case "list_shell_commands":
        return listShellCommands();

      case "read_file":
        return await readFile(input.path as string);

      case "write_file": {
        const filePath = input.path as string;
        const content = input.content as string;

        if (confirm) {
          const answer = await confirm(`write_file: ${filePath}`);
          if (answer === false) {
            return `[write_file] Cancelled by user.`;
          }
        }

        return await writeFile(filePath, content);
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
