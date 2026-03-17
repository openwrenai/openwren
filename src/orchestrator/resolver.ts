/**
 * Dependency resolver — deterministic code, no LLM calls.
 *
 * Reacts to task lifecycle events and drives the DAG forward:
 * - On task_completed: unblock dependent tasks, check for workflow completion
 * - On task_failed: cascade-cancel child tasks, notify assigning manager
 * - Deadlock detection: log warning if tasks are stuck
 *
 * All state lives in SQLite. Events are lightweight triggers.
 */

import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { workflows, tasks, taskDeps } from "./schema";
import { bus } from "../events";
import type { TaskCompletedEvent, TaskFailedEvent } from "../events";

/**
 * Called when a task completes. Checks if any dependent tasks can now be
 * unblocked, handles parent-task auto-completion, and checks if the
 * entire workflow is done.
 *
 * @param event - The task_completed event payload from the bus
 * @returns Array of task IDs that were unblocked (for the queue to pick up)
 */
export function onTaskCompleted(event: TaskCompletedEvent): number[] {
  const db = getDb();
  const unblocked: number[] = [];

  // Find all tasks that depend on the completed task
  const dependents = db.select({ taskId: taskDeps.taskId })
    .from(taskDeps)
    .where(eq(taskDeps.dependsOn, event.taskId))
    .all();

  for (const dep of dependents) {
    // Check if ALL dependencies for this task are now completed
    const allDeps = db.select({ dependsOn: taskDeps.dependsOn })
      .from(taskDeps)
      .where(eq(taskDeps.taskId, dep.taskId))
      .all();

    const depTaskIds = allDeps.map(d => d.dependsOn);

    // Query all dependency tasks to check their status
    const depTasks = depTaskIds.length > 0
      ? db.select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.id, depTaskIds))
          .all()
      : [];

    const allMet = depTasks.every(t => t.status === "completed");

    if (allMet) {
      // Unblock: change from blocked → queued
      const task = db.select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, dep.taskId))
        .get();

      if (task && task.status === "blocked") {
        db.update(tasks)
          .set({ status: "queued" })
          .where(eq(tasks.id, dep.taskId))
          .run();

        console.log(`[resolver] Unblocked task ${dep.taskId} — all dependencies met`);
        unblocked.push(dep.taskId);
      }
    }
  }

  // Check for parent-task auto-completion:
  // If the completed task has a parentTask, check if ALL sibling tasks
  // (tasks with the same parentTask) are completed → auto-complete the parent.
  const completedTask = db.select({
    parentTask: tasks.parentTask,
    workflowId: tasks.workflowId,
  })
    .from(tasks)
    .where(eq(tasks.id, event.taskId))
    .get();

  if (completedTask?.parentTask) {
    const siblings = db.select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.parentTask, completedTask.parentTask))
      .all();

    const allSiblingsDone = siblings.every(s => s.status === "completed");

    if (allSiblingsDone) {
      const parentId = completedTask.parentTask;

      db.update(tasks)
        .set({
          status: "completed",
          completedAt: Date.now(),
        })
        .where(eq(tasks.id, parentId))
        .run();

      const parent = db.select({
        slug: tasks.slug,
        workflowId: tasks.workflowId,
        agentId: tasks.agentId,
        assignedBy: tasks.assignedBy,
      })
        .from(tasks)
        .where(eq(tasks.id, parentId))
        .get();

      if (parent) {
        console.log(`[resolver] Auto-completed parent task ${parent.slug} — all sub-tasks done`);

        const parentEvent: TaskCompletedEvent = {
          taskId: parentId,
          slug: parent.slug,
          workflowId: parent.workflowId,
          agentId: parent.agentId,
          assignedBy: parent.assignedBy,
          summary: "All sub-tasks completed.",
          timestamp: Date.now(),
        };

        bus.emit("task_completed", parentEvent);

        // Recursively resolve the parent's dependents
        const parentUnblocked = onTaskCompleted(parentEvent);
        unblocked.push(...parentUnblocked);
      }
    }
  }

  // Check if the entire workflow is complete
  checkWorkflowComplete(event.workflowId);

  return unblocked;
}

/**
 * Called when a task fails. Cascade-cancels all tasks that depend on the
 * failed task (they can never run) and cancels child tasks (sub-tasks
 * created by a mid-level manager). Checks if the workflow should be
 * marked as failed.
 *
 * @param event - The task_failed event payload from the bus
 */
export function onTaskFailed(event: TaskFailedEvent): void {
  const db = getDb();

  // Cancel all tasks that depend on the failed task (they can never run)
  const dependents = db.select({ taskId: taskDeps.taskId })
    .from(taskDeps)
    .where(eq(taskDeps.dependsOn, event.taskId))
    .all();

  for (const dep of dependents) {
    const task = db.select({ status: tasks.status, slug: tasks.slug })
      .from(tasks)
      .where(eq(tasks.id, dep.taskId))
      .get();

    if (task && (task.status === "blocked" || task.status === "queued")) {
      db.update(tasks)
        .set({
          status: "cancelled",
          completedAt: Date.now(),
          error: `Cancelled — dependency task ${event.slug} failed: ${event.error}`,
        })
        .where(eq(tasks.id, dep.taskId))
        .run();

      console.log(`[resolver] Cancelled task ${task.slug} — dependency ${event.slug} failed`);

      // Recursively cancel downstream dependents
      onTaskFailed({
        ...event,
        taskId: dep.taskId,
        slug: task.slug,
      });
    }
  }

  // Cancel child tasks (tasks with parentTask = failed task)
  const children = db.select({ id: tasks.id, slug: tasks.slug, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.parentTask, event.taskId))
    .all();

  for (const child of children) {
    if (child.status === "blocked" || child.status === "queued") {
      db.update(tasks)
        .set({
          status: "cancelled",
          completedAt: Date.now(),
          error: `Cancelled — parent task ${event.slug} failed`,
        })
        .where(eq(tasks.id, child.id))
        .run();

      console.log(`[resolver] Cancelled child task ${child.slug} — parent ${event.slug} failed`);
    }
  }

  // Check if workflow should be marked as failed
  checkWorkflowComplete(event.workflowId);
}

/**
 * Check if all tasks in a workflow are in a terminal state (completed,
 * cancelled, failed). If so, marks the workflow as complete or failed,
 * builds a summary from task results, and emits workflow_completed on
 * the bus. Also detects deadlocks — blocked tasks with nothing queued
 * or running.
 *
 * @param workflowId - The workflow to check
 */
function checkWorkflowComplete(workflowId: number): void {
  const db = getDb();

  const allTasks = db.select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.workflowId, workflowId))
    .all();

  if (allTasks.length === 0) return;

  const terminal = ["completed", "cancelled", "failed"];
  const allDone = allTasks.every(t => terminal.includes(t.status));

  if (!allDone) {
    // Deadlock detection: if nothing is queued or running but some are blocked
    const statuses = allTasks.map(t => t.status);
    const hasBlocked = statuses.includes("blocked");
    const hasActive = statuses.includes("queued") || statuses.includes("in_progress");
    if (hasBlocked && !hasActive) {
      console.warn(`[resolver] Deadlock detected in workflow ${workflowId} — blocked tasks with nothing queued or running`);
    }
    return;
  }

  // All tasks terminal — determine workflow status
  const hasFailed = allTasks.some(t => t.status === "failed" || t.status === "cancelled");
  const status = hasFailed ? "failed" : "completed";

  const workflow = db.select({
    slug: workflows.slug,
    name: workflows.name,
    managerAgentId: workflows.managerAgentId,
    status: workflows.status,
  })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .get();

  if (!workflow || workflow.status !== "running") return;

  // Build workflow summary from top-level task results
  const topTasks = db.select({
    slug: tasks.slug,
    status: tasks.status,
    resultSummary: tasks.resultSummary,
    error: tasks.error,
  })
    .from(tasks)
    .where(eq(tasks.workflowId, workflowId))
    .all();

  const summary = topTasks
    .map(t => {
      if (t.status === "completed") return `${t.slug}: ${t.resultSummary ?? "done"}`;
      if (t.status === "failed") return `${t.slug}: FAILED — ${t.error}`;
      if (t.status === "cancelled") return `${t.slug}: cancelled`;
      return `${t.slug}: ${t.status}`;
    })
    .join("\n");

  db.update(workflows)
    .set({ status, completedAt: Date.now(), summary })
    .where(eq(workflows.id, workflowId))
    .run();

  console.log(`[resolver] Workflow ${workflow.slug} → ${status}`);

  bus.emit("workflow_completed", {
    workflowId,
    slug: workflow.slug,
    name: workflow.name,
    managerAgentId: workflow.managerAgentId,
    summary,
    timestamp: Date.now(),
  });
}

/**
 * Detect tasks that should be queued but are stuck in blocked state
 * (all dependencies already met). Used on startup recovery and after
 * enqueuing tasks to catch any missed unblocks.
 *
 * @param workflowId - The workflow to scan for stuck blocked tasks
 * @returns Array of task IDs that were unblocked
 */
export function resolveReady(workflowId: number): number[] {
  const db = getDb();
  const unblocked: number[] = [];

  const blockedTasks = db.select({ id: tasks.id, slug: tasks.slug })
    .from(tasks)
    .where(and(eq(tasks.workflowId, workflowId), eq(tasks.status, "blocked")))
    .all();

  for (const task of blockedTasks) {
    const deps = db.select({ dependsOn: taskDeps.dependsOn })
      .from(taskDeps)
      .where(eq(taskDeps.taskId, task.id))
      .all();

    if (deps.length === 0) {
      // No deps but blocked? Shouldn't happen, but fix it
      db.update(tasks).set({ status: "queued" }).where(eq(tasks.id, task.id)).run();
      console.log(`[resolver] Unblocked task ${task.slug} — no dependencies`);
      unblocked.push(task.id);
      continue;
    }

    const depIds = deps.map(d => d.dependsOn);
    const depTasks = db.select({ status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, depIds))
      .all();

    if (depTasks.every(t => t.status === "completed")) {
      db.update(tasks).set({ status: "queued" }).where(eq(tasks.id, task.id)).run();
      console.log(`[resolver] Unblocked task ${task.slug} — all dependencies already met`);
      unblocked.push(task.id);
    }
  }

  return unblocked;
}
