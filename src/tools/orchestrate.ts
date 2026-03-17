/**
 * Orchestration tools — create_workflow, delegate_task, query_workflow,
 * log_progress, complete_task.
 *
 * Manager tools (create_workflow, delegate_task, query_workflow) are gated
 * by the manager role in config. Worker tools (log_progress, complete_task)
 * require task context — they're only callable during task execution.
 */

import * as fs from "fs";
import * as path from "path";
import { eq, and, desc } from "drizzle-orm";
import type { ToolDefinition } from "../providers";
import type { TaskContext } from "../agent/loop";
import { config, canDelegateTo, getTeamsForAgent, getTeamFolder } from "../config";
import { getDb } from "../orchestrator/db";
import { workflows, tasks, taskDeps, taskLog } from "../orchestrator/schema";
import { getTaskQueue } from "../orchestrator";
import { bus } from "../events";
import { slugTimestamp } from "../utils/timezone";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a slug from a name + timestamp. e.g. "research" → "research-2026-03-17-143022" */
function makeSlug(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${sanitized}-${slugTimestamp(config.timezone)}`;
}

/** Find the team this manager agent manages. Returns team name or null. */
function getManagerTeam(agentId: string): string | null {
  const teams = getTeamsForAgent(agentId);
  const managed = teams.find(t => t.role === "manager");
  return managed?.name ?? null;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const createWorkflowToolDefinition: ToolDefinition = {
  name: "create_workflow",
  description: "Create a new workflow. Returns a workflow ID and team folder path. Call this before delegate_task.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Descriptive name for the workflow, e.g. 'Daily Project Report'",
      },
    },
    required: ["name"],
  },
};

export const delegateTaskToolDefinition: ToolDefinition = {
  name: "delegate_task",
  description: "Delegate a task to a team member. Returns the task ID. Use dependsOn with task IDs from previous delegate_task calls to declare dependencies.",
  input_schema: {
    type: "object",
    properties: {
      workflowId: {
        type: "number",
        description: "Workflow ID from create_workflow or from task context (mid-level managers)",
      },
      to: {
        type: "string",
        description: "Agent ID of the team member to delegate to",
      },
      name: {
        type: "string",
        description: "Short task name for tracking, e.g. 'research', 'write-report'",
      },
      prompt: {
        type: "string",
        description: "Clear work order. Include the team folder path so the worker knows where to read/write files.",
      },
      dependsOn: {
        type: "array",
        items: { type: "number" },
        description: "Array of task IDs that must complete before this task starts",
      },
    },
    required: ["workflowId", "to", "name", "prompt"],
  },
};

export const queryWorkflowToolDefinition: ToolDefinition = {
  name: "query_workflow",
  description: "Query workflow status. Returns tasks with statuses and progress entries.",
  input_schema: {
    type: "object",
    properties: {
      workflowId: {
        type: "number",
        description: "Specific workflow ID to query",
      },
      status: {
        type: "string",
        description: "Filter by workflow status: 'running', 'completed', 'failed'",
      },
      date: {
        type: "string",
        description: "Filter by date: 'today' or 'YYYY-MM-DD'",
      },
    },
  },
};

export const logProgressToolDefinition: ToolDefinition = {
  name: "log_progress",
  description: "Log a progress update for the current task. Visible to managers and users checking workflow status.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "One short sentence describing current progress. No markdown, no lists. Max 150 characters.",
      },
    },
    required: ["message"],
  },
};

export const completeTaskToolDefinition: ToolDefinition = {
  name: "complete_task",
  description: "Mark the current task as complete. Call this when your work is done.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One plain-text sentence describing what was accomplished. No markdown, no bullet points, no formatting. Max 150 characters.",
      },
      deliverables: {
        type: "string",
        description: "Optional — file paths or description of outputs produced",
      },
    },
    required: ["summary"],
  },
};

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * Create a new workflow for the manager's team.
 *
 * Inserts a workflow row into the DB, creates a team folder on disk for
 * file deliverables, and returns the workflow ID + folder path. The manager
 * uses the returned ID in subsequent delegate_task calls.
 *
 * @param input - Tool input: { name: string }
 * @param agentId - The manager agent creating the workflow
 * @returns Success message with workflow ID and folder path, or error string
 */
export async function createWorkflow(
  input: Record<string, unknown>,
  agentId: string,
): Promise<string> {
  const name = input.name as string;
  if (!name) return "[create_workflow] Missing required field: name";

  const teamName = getManagerTeam(agentId);
  if (!teamName) return `[create_workflow] Agent "${agentId}" does not manage any team.`;

  const db = getDb();
  const slug = makeSlug(name);

  const result = db.insert(workflows).values({
    slug,
    name,
    managerAgentId: agentId,
    status: "running",
    startedAt: Date.now(),
  }).returning({ id: workflows.id }).get();

  const folderPath = path.join(getTeamFolder(teamName), slug);
  fs.mkdirSync(folderPath, { recursive: true });

  const relativePath = `teams/${teamName}/${slug}`;
  console.log(`[orchestrator] Workflow created: ${slug} (ID: ${result.id}), folder: ${relativePath}`);

  return `Workflow created. ID: ${result.id}, folder: ${relativePath}`;
}

/**
 * Delegate a task to a team member within an existing workflow.
 *
 * Validates delegation permissions, checks the target agent exists,
 * verifies the workflow and any dependencies, then creates the task row
 * and dependency edges. Tasks without dependencies are immediately enqueued
 * for execution; tasks with unmet dependencies are marked as blocked.
 *
 * Sub-managers (agents executing within a task context) can omit workflowId —
 * it falls back to their taskContext.workflowId. Their tasks get parentTask
 * set automatically from the task context.
 *
 * @param input - Tool input: { workflowId, to, name, prompt, dependsOn? }
 * @param agentId - The delegating agent (manager or sub-manager)
 * @param taskContext - Present when called by a sub-manager inside a task
 * @returns Success message with task ID, or error string
 */
export async function delegateTask(
  input: Record<string, unknown>,
  agentId: string,
  taskContext?: TaskContext,
): Promise<string> {
  // Sub-managers always use their task context's workflowId — prevents the LLM
  // from accidentally referencing a different workflow's ID
  const workflowId = taskContext?.workflowId ?? (input.workflowId as number);
  const to = input.to as string;
  const name = input.name as string;
  const prompt = input.prompt as string;
  const dependsOn = (input.dependsOn as number[]) ?? [];

  if (!workflowId) return "[delegate_task] Missing required field: workflowId";
  if (!to) return "[delegate_task] Missing required field: to";
  if (!name) return "[delegate_task] Missing required field: name";
  if (!prompt) return "[delegate_task] Missing required field: prompt";

  // Validate delegation permission
  if (!canDelegateTo(agentId, to)) {
    return `[delegate_task] Cannot delegate to "${to}" — not a member of your team.`;
  }

  // Validate target agent has a soul.md
  const soulPath = path.join(config.workspaceDir, "agents", to, "soul.md");
  if (!fs.existsSync(soulPath)) {
    return `[delegate_task] Agent "${to}" has no soul.md file.`;
  }

  // Validate workflow exists
  const db = getDb();
  const workflow = db.select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .get();

  if (!workflow) {
    return `[delegate_task] Workflow ${workflowId} not found.`;
  }

  // Validate dependencies exist in same workflow
  for (const depId of dependsOn) {
    const dep = db.select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, depId), eq(tasks.workflowId, workflowId)))
      .get();

    if (!dep) {
      return `[delegate_task] Dependency task ${depId} not found in workflow ${workflowId}.`;
    }
  }

  const slug = makeSlug(name);
  // Tasks with dependencies start blocked; the resolver unblocks them when deps complete
  const status = dependsOn.length > 0 ? "blocked" : "queued";

  // Insert task row — parentTask links sub-tasks to their sub-manager's task
  const result = db.insert(tasks).values({
    slug,
    workflowId,
    agentId: to,
    assignedBy: agentId,
    parentTask: taskContext?.taskId ?? null,
    prompt,
    status,
    createdAt: Date.now(),
  }).returning({ id: tasks.id }).get();

  // Insert dependency edges into task_deps table
  for (const depId of dependsOn) {
    db.insert(taskDeps).values({
      taskId: result.id,
      dependsOn: depId,
    }).run();
  }

  console.log(`[orchestrator] Task created: ${slug} (ID: ${result.id}) → ${to}, status: ${status}`);

  // Queued tasks (no deps) go straight into the execution queue
  if (status === "queued") {
    getTaskQueue().enqueue(result.id, to);
  }

  if (status === "blocked") {
    return `Task created (blocked). ID: ${result.id}. Waiting on: ${dependsOn.join(", ")}`;
  }
  return `Task created (queued). ID: ${result.id}`;
}

/**
 * Query workflow status and task details.
 *
 * Returns a formatted text report of workflows matching the query. Includes
 * per-task status, dependency info, result summaries, errors, and the latest
 * progress log entries. Supports filtering by workflow ID, status, or date.
 * Defaults to the 10 most recent workflows.
 *
 * @param input - Tool input: { workflowId?, status?, date? }
 * @param agentId - The querying agent (for future access control)
 * @returns Formatted text report of matching workflows and their tasks
 */
export async function queryWorkflow(
  input: Record<string, unknown>,
  agentId: string,
): Promise<string> {
  const db = getDb();
  const workflowId = input.workflowId as number | undefined;
  const status = input.status as string | undefined;
  const date = input.date as string | undefined;

  // Query workflows with cascading filters:
  // 1. If workflowId provided → fetch that specific workflow
  // 2. If status provided → fetch all workflows matching that status (e.g. "running")
  // 3. Otherwise → fetch the 10 most recent workflows as a default overview
  let workflowRows;

  if (workflowId) {
    workflowRows = db.select()
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .all();
  } else if (status) {
    workflowRows = db.select()
      .from(workflows)
      .where(eq(workflows.status, status))
      .all();
  } else {
    workflowRows = db.select()
      .from(workflows)
      .orderBy(desc(workflows.startedAt))
      .limit(10)
      .all();
  }

  if (workflowRows.length === 0) {
    return "No workflows found.";
  }

  // Build a formatted text report — one section per workflow with nested task details
  const lines: string[] = [];

  for (const wf of workflowRows) {
    // Workflow header: ID, name, status, timestamps, summary
    lines.push(`## Workflow ${wf.id}: ${wf.name} (${wf.status})`);
    lines.push(`  Slug: ${wf.slug}`);
    lines.push(`  Manager: ${wf.managerAgentId}`);
    lines.push(`  Started: ${new Date(wf.startedAt).toISOString()}`);
    if (wf.completedAt) lines.push(`  Completed: ${new Date(wf.completedAt).toISOString()}`);
    if (wf.summary) lines.push(`  Summary: ${wf.summary}`);

    // Fetch all tasks belonging to this workflow
    const taskRows = db.select()
      .from(tasks)
      .where(eq(tasks.workflowId, wf.id))
      .all();

    for (const t of taskRows) {
      // Resolve dependency list for display (e.g. "deps: 1, 2")
      const deps = db.select({ dependsOn: taskDeps.dependsOn })
        .from(taskDeps)
        .where(eq(taskDeps.taskId, t.id))
        .all()
        .map(d => d.dependsOn);
      const depStr = deps.length > 0 ? ` (deps: ${deps.join(", ")})` : "";

      // Task line: ID, slug, assigned agent, status, dependencies
      lines.push(`  - Task ${t.id}: ${t.slug} → ${t.agentId} [${t.status}]${depStr}`);
      if (t.resultSummary) lines.push(`    Result: ${t.resultSummary}`);
      if (t.error) lines.push(`    Error: ${t.error}`);

      // Show up to 3 most recent progress log entries (newest first)
      const logs = db.select()
        .from(taskLog)
        .where(eq(taskLog.taskId, t.id))
        .orderBy(desc(taskLog.timestamp))
        .limit(3)
        .all();

      for (const log of logs) {
        lines.push(`    [${new Date(log.timestamp).toISOString()}] ${log.entry}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Log a progress update for the currently executing task.
 *
 * Inserts an entry into the task_log table. Progress entries are visible
 * to managers via query_workflow and to users checking workflow status.
 * Can only be called during task execution (requires task context).
 *
 * @param input - Tool input: { message: string }
 * @param agentId - The agent logging progress
 * @param taskContext - Required — identifies which task this progress belongs to
 * @returns Confirmation string, or error if called outside task execution
 */
export async function logProgress(
  input: Record<string, unknown>,
  agentId: string,
  taskContext?: TaskContext,
): Promise<string> {
  if (!taskContext) {
    return "[log_progress] This tool can only be used during task execution.";
  }

  const message = input.message as string;
  if (!message) return "[log_progress] Missing required field: message";

  const db = getDb();
  db.insert(taskLog).values({
    taskId: taskContext.taskId,
    agentId,
    timestamp: Date.now(),
    entry: message,
  }).run();

  console.log(`[orchestrator] Progress (task ${taskContext.slug}): ${message.slice(0, 100)}`);

  return "Progress logged.";
}

/**
 * Mark the current task as complete.
 *
 * Updates the task row in the DB with status "completed", stores the summary
 * and optional deliverables, then emits a task_completed event on the bus.
 * The resolver listens for this event to unblock dependent tasks, check for
 * workflow completion, and trigger notifications.
 *
 * Can only be called during task execution (requires task context). If an
 * agent finishes without calling this, the runner auto-completes the task
 * with the agent's reply text as the summary.
 *
 * @param input - Tool input: { summary: string, deliverables?: string }
 * @param taskContext - Required — identifies which task to complete
 * @returns Confirmation string, or error if called outside task execution
 */
export async function completeTask(
  input: Record<string, unknown>,
  taskContext?: TaskContext,
): Promise<string> {
  if (!taskContext) {
    return "[complete_task] This tool can only be used during task execution.";
  }

  const summary = input.summary as string;
  const deliverables = input.deliverables as string | undefined;
  if (!summary) return "[complete_task] Missing required field: summary";

  const db = getDb();

  // Mark task as completed in DB with summary and deliverables
  db.update(tasks)
    .set({
      status: "completed",
      completedAt: Date.now(),
      resultSummary: summary,
      deliverables: deliverables ?? null,
    })
    .where(eq(tasks.id, taskContext.taskId))
    .run();

  console.log(`[orchestrator] Task ${taskContext.slug} completed: ${summary.slice(0, 100)}`);

  // Emit event — resolver listens to unblock dependents and check workflow completion
  bus.emit("task_completed", {
    taskId: taskContext.taskId,
    slug: taskContext.slug,
    workflowId: taskContext.workflowId,
    agentId: taskContext.agentId,
    assignedBy: taskContext.assignedBy,
    summary,
    deliverables,
    timestamp: Date.now(),
  });

  return "Task marked as complete.";
}
