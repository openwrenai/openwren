/**
 * Task execution queue for the orchestrator.
 *
 * Different from the scheduler queue (scheduler/queue.ts) which is strictly
 * sequential (one job at a time to avoid API rate limits).
 *
 * This queue allows parallel execution across agents — researcher and analyst
 * can run simultaneously — but enforces sequential execution per agent (one
 * agent loop at a time per agent ID). This prevents concurrent writes to the
 * same agent's session files and avoids API rate limit issues per-agent.
 */

/** Function that executes a single task by its ID. Provided by the caller (executeTask from runner.ts). */
type TaskProcessor = (taskId: number) => Promise<void>;

/**
 * Per-agent FIFO task queue with parallel cross-agent execution.
 *
 * Each agent gets its own internal queue. Tasks for different agents run
 * in parallel, but tasks for the same agent run sequentially. This prevents
 * session file conflicts and per-agent API rate limits while maximizing
 * throughput across the team.
 */
export class TaskQueue {
  /** Per-agent FIFO queues. Key is agentId, value is array of pending taskIds. */
  private agentQueues = new Map<string, number[]>();

  /** Set of agentIds currently executing a task. */
  private agentBusy = new Set<string>();

  /** The function called to execute each task (injected via constructor). */
  private processor: TaskProcessor;

  /** Maps taskId → agentId for cleanup after execution. Set by enqueue(). */
  private taskAgentMap = new Map<number, string>();

  /**
   * Create a new TaskQueue.
   *
   * @param processor - Function that executes a single task by ID (typically executeTask from runner.ts)
   */
  constructor(processor: TaskProcessor) {
    this.processor = processor;
  }

  /**
   * Enqueue a task for a specific agent. If the agent is idle, processing
   * starts immediately. If the agent is busy with another task, this task
   * waits in the agent's FIFO queue.
   *
   * @param taskId - The task's database ID
   * @param agentId - The agent assigned to execute this task
   */
  enqueue(taskId: number, agentId: string): void {
    this.taskAgentMap.set(taskId, agentId);

    if (!this.agentQueues.has(agentId)) {
      this.agentQueues.set(agentId, []);
    }
    this.agentQueues.get(agentId)!.push(taskId);

    if (!this.agentBusy.has(agentId)) {
      this.processNext(agentId);
    }
  }

  /**
   * Number of tasks waiting across all agents (not including currently executing).
   *
   * @returns Total count of queued but not yet executing tasks
   */
  get pending(): number {
    let total = 0;
    for (const queue of this.agentQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Whether any agent is currently executing a task.
   *
   * @returns True if at least one agent is busy
   */
  get isProcessing(): boolean {
    return this.agentBusy.size > 0;
  }

  /**
   * Returns agent IDs that are currently running a task.
   *
   * @returns Array of busy agent ID strings
   */
  get busyAgents(): string[] {
    return [...this.agentBusy];
  }

  /**
   * Process the next task in an agent's queue. Marks the agent as busy,
   * pops the next taskId, calls the processor, then recursively processes
   * the next task (if any). If the queue is empty, marks the agent as idle.
   *
   * Errors from the processor are caught and logged — they don't break the
   * queue. The next task for this agent will still be processed.
   *
   * @param agentId - The agent whose queue to process
   */
  private async processNext(agentId: string): Promise<void> {
    const queue = this.agentQueues.get(agentId);
    if (!queue || queue.length === 0) {
      this.agentBusy.delete(agentId);
      return;
    }

    this.agentBusy.add(agentId);
    const taskId = queue.shift()!;

    try {
      await this.processor(taskId);
    } catch (err) {
      console.error(`[orchestrator] Queue error for task ${taskId} (agent: ${agentId}):`, err);
    }

    // Clean up task-agent mapping
    this.taskAgentMap.delete(taskId);

    // Process next task for this agent (if any)
    this.processNext(agentId);
  }
}
