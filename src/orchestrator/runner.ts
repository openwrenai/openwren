/**
 * Task runner — executes a single delegated task.
 *
 * Updates task status in SQLite, creates a task-specific session file,
 * runs the agent loop, and emits lifecycle events. The resolver reacts
 * to those events to drive the DAG forward.
 *
 * Similar to scheduler/runner.ts but for orchestrated tasks instead of
 * cron jobs. Key differences:
 * - Uses task sessions (agents/{agentId}/sessions/tasks/{slug}.jsonl)
 * - No channel delivery — results stay in DB, manager/user get notified separately
 * - Passes taskContext so tools like complete_task and log_progress know which task they're acting on
 */

import { eq } from "drizzle-orm";
import { config } from "../config";
import { agentTaskSessionPath } from "../config";
import { runAgentLoop } from "../agent/loop";
import { getDb } from "./db";
import { tasks } from "./schema";
import { bus } from "../events";

/**
 * Execute a single task. Called by the TaskQueue processor.
 *
 * Flow:
 * 1. Load task from DB, verify it's queued
 * 2. Set status → in_progress, emit task_started
 * 3. Run agent loop with task prompt
 * 4. On success: if agent didn't call complete_task, auto-complete with the reply
 * 5. On failure: set status → failed, emit task_failed
 */
export async function executeTask(taskId: number): Promise<void> {
  const db = getDb();

  // Load task
  const task = db.select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();

  if (!task) {
    console.error(`[runner] Task ${taskId} not found in DB`);
    return;
  }

  if (task.status !== "queued") {
    console.warn(`[runner] Task ${task.slug} has status "${task.status}", expected "queued" — skipping`);
    return;
  }

  // Resolve agent config
  const agentConfig = config.agents[task.agentId];
  if (!agentConfig) {
    failTask(task.id, task.slug, task.workflowId, task.agentId, task.assignedBy,
      `Unknown agent: "${task.agentId}"`);
    return;
  }

  // Session file for this task
  const sessionFile = agentTaskSessionPath(task.agentId, task.slug);

  // Update to in_progress
  db.update(tasks)
    .set({ status: "in_progress", startedAt: Date.now(), sessionPath: sessionFile })
    .where(eq(tasks.id, task.id))
    .run();

  console.log(`[runner] Starting task ${task.slug} → agent ${task.agentId}`);

  bus.emit("task_started", {
    taskId: task.id,
    slug: task.slug,
    workflowId: task.workflowId,
    agentId: task.agentId,
    timestamp: Date.now(),
  });

  try {
    const result = await runAgentLoop(
      "system",        // userId — tasks run as "system", not a specific user
      task.agentId,
      agentConfig,
      task.prompt,
      undefined,       // No confirm callback — tasks don't get user confirmation
      true,            // quiet — suppress per-skill log lines
      {
        sessionFile,
        skipMaintenance: true, // Task sessions don't compact or idle-reset
        taskContext: {
          taskId: task.id,
          workflowId: task.workflowId,
          slug: task.slug,
          agentId: task.agentId,
          assignedBy: task.assignedBy,
        },
      },
    );

    // Check if the agent already called complete_task (Step 7 will set status=completed).
    // If not, auto-complete with the agent's reply text.
    const current = db.select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .get();

    if (current && current.status === "in_progress") {
      // Agent finished without calling complete_task.
      // Check if this task has sub-tasks (it's a sub-manager that delegated).
      // If so, skip auto-complete — the resolver will handle it when all
      // sub-tasks finish via parent-task auto-completion.
      const children = db.select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.parentTask, task.id))
        .all();

      if (children.length > 0) {
        console.log(`[runner] Task ${task.slug} has ${children.length} sub-task(s) — skipping auto-complete, resolver will handle it`);
      } else {
        // Leaf worker that forgot to call complete_task — auto-complete
        db.update(tasks)
          .set({
            status: "completed",
            completedAt: Date.now(),
            resultSummary: result.text.slice(0, 500),
          })
          .where(eq(tasks.id, task.id))
          .run();

        console.log(`[runner] Task ${task.slug} auto-completed (agent didn't call complete_task)`);

        bus.emit("task_completed", {
          taskId: task.id,
          slug: task.slug,
          workflowId: task.workflowId,
          agentId: task.agentId,
          assignedBy: task.assignedBy,
          summary: result.text.slice(0, 500),
          timestamp: Date.now(),
        });
      }
    }
    // If status is already "completed", complete_task tool already emitted the event.

  } catch (err) {
    const error = err as Error;
    failTask(task.id, task.slug, task.workflowId, task.agentId, task.assignedBy, error.message);
  }
}

/**
 * Mark a task as failed and emit the event.
 */
function failTask(
  taskId: number, slug: string, workflowId: number,
  agentId: string, assignedBy: string, error: string,
): void {
  const db = getDb();

  db.update(tasks)
    .set({ status: "failed", completedAt: Date.now(), error })
    .where(eq(tasks.id, taskId))
    .run();

  console.error(`[runner] Task ${slug} failed: ${error}`);

  bus.emit("task_failed", {
    taskId, slug, workflowId, agentId, assignedBy, error,
    timestamp: Date.now(),
  });
}
