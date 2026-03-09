/**
 * manage_schedule tool — lets agents create, list, update, delete, enable,
 * and disable scheduled jobs on behalf of the user.
 *
 * The tool description is intentionally minimal — it tells the agent to
 * load the `scheduling` skill (via load_skill) for full instructions,
 * schedule format reference, and examples. This saves tokens on every API
 * call since most conversations don't involve scheduling. The skill body
 * contains the "confirm before creating" instructions and cron examples.
 */

import type { ToolDefinition } from "../providers";
import {
  createJob,
  deleteJob,
  enableJob,
  disableJob,
  listJobs,
  getJob,
  updateJob,
} from "../scheduler";

// ---------------------------------------------------------------------------
// Tool definition — sent to the LLM with every API call
// ---------------------------------------------------------------------------

export const manageScheduleToolDefinition: ToolDefinition = {
  name: "manage_schedule",
  description: [
    "Create, list, update, delete, enable, or disable scheduled jobs.",
    "Scheduled jobs run agent prompts on a timer (cron, interval, or one-shot).",
    "For create/update, load the `scheduling` skill first for schedule format",
    "reference and confirmation instructions.",
    "List, enable, disable, and delete work without loading the skill.",
  ].join("\n"),
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "update", "delete", "enable", "disable"],
        description: "The operation to perform",
      },
      name: {
        type: "string",
        description: "Human-readable name for the job (used for create)",
      },
      schedule: {
        type: "object",
        description: 'Schedule definition. One of: { "cron": "..." }, { "every": "..." }, { "at": "..." }',
      },
      prompt: {
        type: "string",
        description: "The prompt/instruction the agent will receive when the job fires",
      },
      channel: {
        type: "string",
        description: "Delivery channel (telegram, discord). Defaults to current channel.",
      },
      jobId: {
        type: "string",
        description: "Job ID (required for update, delete, enable, disable)",
      },
      isolated: {
        type: "boolean",
        description: "Run in isolated session (default true). Set false for main-session context.",
      },
      deleteAfterRun: {
        type: "boolean",
        description: "Delete one-shot jobs after they fire (default false)",
      },
    },
    required: ["action"],
  },
};

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

export async function manageSchedule(
  input: Record<string, unknown>,
  agentId: string,
  channel?: string
): Promise<string> {
  const action = input.action as string;

  switch (action) {
    case "create": {
      const name = input.name as string;
      const schedule = input.schedule as { cron?: string; every?: string; at?: string } | undefined;
      const prompt = input.prompt as string;

      if (!name) return "[schedule] Error: name is required for create";
      if (!schedule) return "[schedule] Error: schedule is required for create";
      if (!prompt) return "[schedule] Error: prompt is required for create";

      // Validate schedule has exactly one type
      const types = [schedule.cron, schedule.every, schedule.at].filter(Boolean);
      if (types.length !== 1) {
        return '[schedule] Error: schedule must have exactly one of: cron, every, at';
      }

      const jobId = createJob({
        name,
        agent: agentId,
        schedule,
        prompt,
        channel: (input.channel as string) ?? channel ?? "telegram",
        isolated: (input.isolated as boolean) ?? true,
        deleteAfterRun: (input.deleteAfterRun as boolean) ?? false,
        createdBy: agentId,
      });

      return `[schedule] Created job "${jobId}" (${name}). It is now active.`;
    }

    case "list": {
      const allJobs = listJobs();
      if (allJobs.length === 0) return "[schedule] No scheduled jobs.";

      const lines = allJobs.map(({ jobId, job, nextRun }) => {
        const status = job.enabled ? "enabled" : "disabled";
        const scheduleStr = job.schedule.cron ?? job.schedule.every ?? job.schedule.at ?? "unknown";
        const next = nextRun ? ` (next: ${nextRun})` : "";
        return `- ${jobId}: "${job.name}" [${status}] schedule=${scheduleStr} agent=${job.agent}${next}`;
      });

      return `[schedule] ${allJobs.length} jobs:\n${lines.join("\n")}`;
    }

    case "update": {
      const jobId = input.jobId as string;
      if (!jobId) return "[schedule] Error: jobId is required for update";

      const existing = getJob(jobId);
      if (!existing) return `[schedule] Error: job "${jobId}" not found`;

      const updates: Partial<Record<string, unknown>> = {};
      if (input.name) updates.name = input.name;
      if (input.schedule) updates.schedule = input.schedule;
      if (input.prompt) updates.prompt = input.prompt;
      if (input.channel) updates.channel = input.channel;
      if (input.isolated !== undefined) updates.isolated = input.isolated;

      updateJob(jobId, updates as any);
      return `[schedule] Updated job "${jobId}".`;
    }

    case "delete": {
      const jobId = input.jobId as string;
      if (!jobId) return "[schedule] Error: jobId is required for delete";

      const success = await deleteJob(jobId);
      return success
        ? `[schedule] Deleted job "${jobId}" and its run history.`
        : `[schedule] Error: job "${jobId}" not found.`;
    }

    case "enable": {
      const jobId = input.jobId as string;
      if (!jobId) return "[schedule] Error: jobId is required for enable";

      const success = enableJob(jobId);
      return success
        ? `[schedule] Enabled job "${jobId}".`
        : `[schedule] Error: job "${jobId}" not found.`;
    }

    case "disable": {
      const jobId = input.jobId as string;
      if (!jobId) return "[schedule] Error: jobId is required for disable";

      const success = disableJob(jobId);
      return success
        ? `[schedule] Disabled job "${jobId}".`
        : `[schedule] Error: job "${jobId}" not found.`;
    }

    default:
      return `[schedule] Error: unknown action "${action}". Use: create, list, update, delete, enable, disable.`;
  }
}
