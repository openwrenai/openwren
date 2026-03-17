/**
 * Orchestrator — barrel exports and event wiring.
 *
 * Subscribes to task lifecycle events on the bus and wires them to the
 * resolver (dependency logic) and queue (execution). This is the glue
 * between the event system and the execution engine.
 *
 * Startup: call startOrchestrator() after the event bus is available.
 * Shutdown: call stopOrchestrator() during graceful shutdown.
 */

import { eq, and } from "drizzle-orm";
import { bus } from "../events";
import type { TaskCompletedEvent, TaskFailedEvent } from "../events";
import { TaskQueue } from "./queue";
import { executeTask } from "./runner";
import { onTaskCompleted, onTaskFailed, resolveReady } from "./resolver";
import { registerNotify, unregisterNotify } from "./notify";
import { getDb } from "./db";
import { workflows, tasks } from "./schema";

// Re-export for external use
export { getDb, closeDb } from "./db";
export { TaskQueue } from "./queue";
export { executeTask } from "./runner";
export { onTaskCompleted, onTaskFailed, resolveReady } from "./resolver";

// ---------------------------------------------------------------------------
// Singleton task queue
// ---------------------------------------------------------------------------

let taskQueue: TaskQueue | null = null;

/**
 * Lazy singleton for the task execution queue. Creates the TaskQueue on
 * first access with executeTask as the processor function.
 *
 * @returns The shared TaskQueue instance
 */
export function getTaskQueue(): TaskQueue {
  if (!taskQueue) {
    taskQueue = new TaskQueue(executeTask);
  }
  return taskQueue;
}

// ---------------------------------------------------------------------------
// Event listeners — wire bus events to resolver + queue
// ---------------------------------------------------------------------------

/**
 * Glue between resolver and queue. Passes the completion event to the
 * resolver for dependency checking, then enqueues any tasks that were
 * unblocked (all their dependencies are now met).
 *
 * @param event - The task_completed event payload from the bus
 */
function handleTaskCompleted(event: TaskCompletedEvent): void {
  // Resolver checks dependencies and returns newly unblocked task IDs
  const unblocked = onTaskCompleted(event);

  // Enqueue unblocked tasks
  const db = getDb();
  const queue = getTaskQueue();
  for (const taskId of unblocked) {
    const task = db.select({ agentId: tasks.agentId, slug: tasks.slug })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();

    if (task) {
      console.log(`[orchestrator] Enqueuing unblocked task ${task.slug} → ${task.agentId}`);
      queue.enqueue(taskId, task.agentId);
    }
  }
}

/**
 * Forwards task failure to the resolver for cascade-cancellation of
 * dependent tasks and child tasks (sub-tasks of mid-level managers).
 *
 * @param event - The task_failed event payload from the bus
 */
function handleTaskFailed(event: TaskFailedEvent): void {
  onTaskFailed(event);
}

// ---------------------------------------------------------------------------
// Recovery — fix stale state after crash/restart
// ---------------------------------------------------------------------------

/**
 * Scan for running workflows with stale task states and recover them
 * after a crash or restart. Runs once at boot after event listeners
 * are registered so that failure cascades work correctly.
 *
 * Recovery steps per workflow:
 * 1. in_progress tasks → marked failed (process died mid-execution),
 *    emits task_failed for cascade-cancellation of dependents
 * 2. queued tasks → re-enqueued (were in memory-only queue, now lost)
 * 3. blocked tasks with all deps met → unblocked via resolveReady()
 */
function recoverWorkflows(): void {
  const db = getDb();

  const runningWorkflows = db.select({ id: workflows.id, slug: workflows.slug })
    .from(workflows)
    .where(eq(workflows.status, "running"))
    .all();

  if (runningWorkflows.length === 0) return;

  const queue = getTaskQueue();

  for (const wf of runningWorkflows) {
    let failed = 0;
    let requeued = 0;
    let unblocked = 0;

    // 1. Fail tasks stuck in in_progress (process died mid-execution)
    const stuckTasks = db.select({
      id: tasks.id,
      slug: tasks.slug,
      agentId: tasks.agentId,
      assignedBy: tasks.assignedBy,
    })
      .from(tasks)
      .where(and(eq(tasks.workflowId, wf.id), eq(tasks.status, "in_progress")))
      .all();

    for (const task of stuckTasks) {
      const error = "Process restarted during execution";
      db.update(tasks)
        .set({ status: "failed", completedAt: Date.now(), error })
        .where(eq(tasks.id, task.id))
        .run();

      failed++;

      // Emit task_failed so the resolver cascade-cancels dependents
      bus.emit("task_failed", {
        taskId: task.id,
        slug: task.slug,
        workflowId: wf.id,
        agentId: task.agentId,
        assignedBy: task.assignedBy,
        error,
        timestamp: Date.now(),
      });
    }

    // 2. Re-enqueue tasks stuck in queued (were in memory queue, now lost)
    const queuedTasks = db.select({ id: tasks.id, slug: tasks.slug, agentId: tasks.agentId })
      .from(tasks)
      .where(and(eq(tasks.workflowId, wf.id), eq(tasks.status, "queued")))
      .all();

    for (const task of queuedTasks) {
      queue.enqueue(task.id, task.agentId);
      requeued++;
    }

    // 3. Unblock tasks whose dependencies are already met
    const unblockedIds = resolveReady(wf.id);
    for (const taskId of unblockedIds) {
      const task = db.select({ agentId: tasks.agentId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get();

      if (task) {
        queue.enqueue(taskId, task.agentId);
        unblocked++;
      }
    }

    if (failed > 0 || requeued > 0 || unblocked > 0) {
      console.log(`[orchestrator] Recovered workflow ${wf.slug}: ${failed} failed, ${requeued} re-queued, ${unblocked} unblocked`);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let started = false;

/**
 * Start the orchestrator — subscribe to bus events and recover stale
 * workflows from previous runs. Call after the event bus is available
 * (early in boot sequence).
 *
 * Subscribes to:
 * - task_completed → resolver (dependency resolution) + queue (enqueue unblocked)
 * - task_failed → resolver (cascade-cancellation)
 * - workflow_completed → notify (wake manager agent)
 * - task_failed → notify (wake manager agent)
 */
export function startOrchestrator(): void {
  if (started) return;

  // Subscribe to task events — routes completions/failures to the resolver for dependency resolution
  bus.on("task_completed", handleTaskCompleted);
  bus.on("task_failed", handleTaskFailed);
  // Subscribe to workflow events — wakes manager agent on completion/failure to notify the user
  registerNotify();

  started = true;
  console.log("[orchestrator] Event listeners registered");

  // Recover any workflows that were running when the process last exited.
  // Must run after event listeners are registered so failure cascades work.
  recoverWorkflows();
}

/**
 * Stop the orchestrator — unsubscribe all event handlers from the bus
 * and release the task queue. Called during graceful shutdown.
 */
export function stopOrchestrator(): void {
  if (!started) return;

  // Unsubscribe resolver event handlers
  bus.off("task_completed", handleTaskCompleted);
  bus.off("task_failed", handleTaskFailed);
  // Unsubscribe notification handlers
  unregisterNotify();

  taskQueue = null;
  started = false;
  console.log("[orchestrator] Stopped");
}
