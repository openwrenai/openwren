/**
 * Workflow notifications — wakes the manager agent when workflows complete
 * or tasks fail, so the LLM can decide how to respond to the user.
 *
 * On workflow completed: injects a prompt into the manager's user session,
 * runs an agent loop turn, and delivers the reply to the user.
 *
 * On task failed: same pattern — wakes the manager to explain the failure
 * and suggest next steps.
 */

import { config } from "../config";
import type { AgentConfig } from "../config";
import { bus } from "../events";
import type { WorkflowCompletedEvent, TaskFailedEvent } from "../events";
import { runAgentLoop } from "../agent/loop";
import { deliverMessage } from "../channels";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the first channel an agent is bound to by scanning config.bindings.
 *
 * @param agentId - The agent to look up a channel binding for
 * @returns Channel name (e.g. "telegram") or null if no binding found
 */
function resolveChannel(agentId: string): string | null {
  for (const [channelName, bindings] of Object.entries(config.bindings)) {
    if (bindings[agentId]) return channelName;
  }
  return null;
}

/**
 * Get the first user ID from config. Used as the default recipient for
 * workflow notifications (single-user simplification).
 *
 * @returns User ID string or null if no users configured
 */
function resolveUserId(): string | null {
  const userIds = Object.keys(config.users);
  return userIds.length > 0 ? userIds[0] : null;
}

// ---------------------------------------------------------------------------
// User notifications — manager wake-up on workflow events
// ---------------------------------------------------------------------------

/**
 * Wake the manager agent when a workflow completes. Injects a completion
 * prompt into the manager's user session, runs an agent loop turn, and
 * delivers the LLM's reply to the user via channel. The prompt instructs
 * the manager to respond as defined in its workflow.md.
 *
 * @param event - The workflow_completed event payload from the bus
 */
async function handleWorkflowCompleted(event: WorkflowCompletedEvent): Promise<void> {
  const { managerAgentId, name, slug, summary } = event;

  const channel = resolveChannel(managerAgentId);
  const userId = resolveUserId();
  const agentConfig = config.agents[managerAgentId];
  if (!channel || !userId || !agentConfig) {
    console.warn(`[notify] Cannot wake manager — no channel, user, or agent config for "${managerAgentId}"`);
    return;
  }

  const prompt = `[workflow:complete] Workflow "${name}" (${slug}) has finished. All tasks completed successfully.\n\n${summary}\n\nRespond to the user as instructed in your workflow.`;

  try {
    const result = await runAgentLoop(
      userId,
      managerAgentId,
      agentConfig,
      prompt,
      undefined,
      true,
      {
        usageContext: {
          source: "notify",
          workflowId: event.workflowId,
          userId,
          sessionId: "main",
        },
      },
    );

    await deliverMessage(channel, userId, managerAgentId, result.text);
    console.log(`[notify] Workflow ${slug} — manager woke and replied via ${channel}`);
  } catch (err) {
    console.error(`[notify] Failed to wake manager for workflow ${slug}:`, err);
  }
}

/**
 * Wake the manager agent when a task fails. Injects a failure prompt into
 * the assigning manager's user session, runs an agent loop turn, and
 * delivers the LLM's reply to the user via channel. The manager explains
 * the failure and its impact on the workflow.
 *
 * @param event - The task_failed event payload from the bus
 */
async function handleTaskFailed(event: TaskFailedEvent): Promise<void> {
  const { slug, workflowId, agentId, assignedBy, error } = event;

  const channel = resolveChannel(assignedBy);
  const userId = resolveUserId();
  const agentConfig = config.agents[assignedBy];
  if (!channel || !userId || !agentConfig) {
    console.warn(`[notify] Cannot wake manager — no channel, user, or agent config for "${assignedBy}"`);
    return;
  }

  const prompt = `[workflow:task_failed] Task "${slug}" assigned to ${agentId} has failed.\nError: ${error}\nWorkflow ID: ${workflowId}\n\nBriefly let the user know about this failure and what it means for the workflow. Keep it concise.`;

  try {
    const result = await runAgentLoop(
      userId,
      assignedBy,
      agentConfig,
      prompt,
      undefined,
      true,
      {
        usageContext: {
          source: "notify",
          workflowId,
          userId,
          sessionId: "main",
        },
      },
    );

    await deliverMessage(channel, userId, assignedBy, result.text);
    console.log(`[notify] Task ${slug} failure — manager woke and replied via ${channel}`);
  } catch (err) {
    console.error(`[notify] Failed to wake manager for task failure ${slug}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Manager notifications (future — LLM-driven retry/skip/abort decisions)
// ---------------------------------------------------------------------------

// Future: on failure, the manager could be given tools to retry the failed
// task, skip it, or abort the workflow. Currently the manager just reports
// the failure to the user.

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Subscribe to workflow_completed and task_failed events on the bus.
 * When these events fire, the corresponding handler wakes the manager
 * agent via runAgentLoop() to notify the user.
 */
export function registerNotify(): void {
  bus.on("workflow_completed", handleWorkflowCompleted);
  bus.on("task_failed", handleTaskFailed);
}

/**
 * Unsubscribe notification handlers from the bus. Called during
 * graceful shutdown via stopOrchestrator().
 */
export function unregisterNotify(): void {
  bus.off("workflow_completed", handleWorkflowCompleted);
  bus.off("task_failed", handleTaskFailed);
}
