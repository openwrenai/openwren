# Orchestrator Architecture

The orchestrator executes workflows — multi-step task pipelines where agents work together as a team. A manager agent creates a DAG (directed acyclic graph) of tasks with dependencies, and the orchestrator runs them mechanically. No LLM is involved in scheduling or dependency resolution.

## How it works

1. User tells the manager agent: "Run the daily report"
2. Manager calls `create_workflow` → gets a workflow ID and team folder
3. Manager calls `delegate_task` multiple times → creates tasks with dependencies
4. Manager goes idle. The orchestrator takes over.
5. Tasks without dependencies start immediately. Tasks with dependencies wait.
6. When a task completes, the resolver checks if any blocked tasks can now run.
7. When all tasks are done, the workflow completes and the user gets a summary.

## Files

### `schema.ts` — Database tables

Drizzle ORM table definitions. Four tables:
- **workflows** — one row per workflow run (name, manager, status, timestamps)
- **tasks** — one row per task (agent, prompt, status, result, parent task)
- **task_deps** — dependency edges (task B depends on task A)
- **task_log** — progress entries workers write as they work

### `db.ts` — Database connection

Lazy singleton. Opens `~/.openwren/data/workflows.db` on first access, runs migrations, returns a Drizzle instance. WAL mode for concurrent reads, foreign keys enforced.

### `queue.ts` — Task execution queue

Manages which tasks run and when. Different from the scheduler queue:
- **Scheduler queue**: strictly sequential (one job at a time)
- **Orchestrator queue**: parallel across agents, sequential per agent

So researcher and analyst can run at the same time, but the same agent never runs two tasks concurrently. This prevents session file conflicts and per-agent API rate limits.

### `runner.ts` — Task executor

Executes a single task. Called by the queue when a task is ready:
1. Sets task status to `in_progress` in DB
2. Emits `task_started` event
3. Creates a task session file (`agents/{agentId}/sessions/tasks/{slug}.jsonl`)
4. Calls `runAgentLoop()` with the task prompt
5. On success: if the agent called `complete_task`, the tool already updated the DB. If not, auto-completes with the agent's reply text.
6. On failure: sets status to `failed`, emits `task_failed`

### `resolver.ts` — Dependency resolution

Pure deterministic code — no LLM calls. Reacts to events:

**On task completed:**
- Finds all tasks that depend on the completed task
- Checks if ALL their dependencies are now met
- If yes: unblocks them (blocked → queued) so the queue picks them up
- Checks for parent-task auto-completion (all children done → parent auto-completes)
- Checks if the entire workflow is done

**On task failed:**
- Cascade-cancels all tasks that depend on the failed task (they can never run)
- Cancels child tasks (sub-tasks created by a mid-level manager)
- Checks if the workflow should be marked as failed

**Deadlock detection:**
- If blocked tasks exist but nothing is queued or running → logs a warning

### `notify.ts` — Workflow notifications (manager wake-up)

Wakes the manager agent when workflows complete or tasks fail. The manager LLM decides how to respond to the user — it might read deliverables, summarize results, or explain failures.

- **On workflow completed:** injects a prompt into the manager's user session, runs `runAgentLoop()`, delivers the reply to the user via `deliverMessage()`. The prompt tells the manager to respond as instructed in its workflow.md.
- **On task failed (original failures only):** same pattern — wakes the manager to explain the failure and its impact on the workflow.
- Lifecycle: `registerNotify()` / `unregisterNotify()` — called from `startOrchestrator()` / `stopOrchestrator()`
- Future: give the manager tools to retry, skip, or abort on failure (currently just reports)

### `index.ts` — Wiring and lifecycle

Glues everything together:
- Creates the singleton TaskQueue
- Subscribes to bus events (`task_completed`, `task_failed`) — routes to resolver, enqueues unblocked tasks
- Calls `registerNotify()` / `unregisterNotify()` for notification lifecycle
- Exports `startOrchestrator()` / `stopOrchestrator()` for the boot/shutdown sequence
- **Recovery on restart:** scans for running workflows after boot. Fails `in_progress` tasks (process died mid-execution, triggers cascade), re-enqueues `queued` tasks (lost from memory), and unblocks `blocked` tasks with all deps met via `resolveReady()`

## Event flow

**Workflow creation (manager agent, via tools):**
```
User says "Run the daily report" → message arrives in manager's user session
  → manager calls create_workflow tool
  → tool creates workflow row in DB, creates team folder
  → returns workflow ID and folder path to manager
  → manager calls delegate_task (once per task)
  → tool creates task row in DB (+ task_deps if dependsOn provided)
  → tasks without deps: status=queued → enqueued in TaskQueue immediately
  → tasks with deps: status=blocked → wait for resolver to unblock
  → manager goes idle after creating all tasks
```

**Task execution (orchestrator, automatic):**
```
TaskQueue picks up a queued task
  → runner.executeTask() called
  → sets status=in_progress in DB, emits task_started on bus
  → calls runAgentLoop() with task prompt and taskContext
  → agent reads files, does work, writes output
  → agent calls complete_task tool
  → tool updates DB (task → completed), emits task_completed on bus
  → (if agent finishes without calling complete_task, runner auto-completes)
```

**Dependency resolution (resolver, automatic):**
```
task_completed event arrives on bus
  → index.ts listener calls resolver.onTaskCompleted()
  → resolver checks: do any blocked tasks have all deps met now?
  → if yes: unblocks them (blocked → queued), returns their IDs
  → index.ts enqueues unblocked tasks in TaskQueue
  → queue picks them up → runner executes → cycle repeats
  → when all tasks done → resolver marks workflow complete
  → emits workflow_completed on bus
  → notify.ts wakes manager agent via runAgentLoop() in user session
  → manager reads workflow.md completion instructions, replies to user via channel
```

**Failure handling (resolver, automatic):**
```
task_failed event arrives on bus
  → resolver.onTaskFailed() called
  → cascade-cancels all dependent tasks and child tasks
  → checks if workflow should be marked as failed
  → notify.ts wakes manager agent to explain failure to user via channel
```

## Key design decisions

- **SQLite is the source of truth.** Events are triggers, not data carriers. If the process crashes, the DB has the full state.
- **The resolver is deterministic code.** No LLM calls for dependency checking. It's a simple graph traversal.
- **One workflow folder for the entire DAG.** Even when sub-teams are involved, all tasks share `teams/{team}/{workflow-slug}/`. Workers read and write files there using `read_file`/`write_file` with full paths provided by the manager in task prompts.
- **Auto-complete fallback.** If an agent finishes without calling `complete_task`, the runner auto-completes with the reply text. The system works even if agents forget to call the tool.
- **Task context flows through the chain.** `runner → runAgentLoop (opts.taskContext) → executeTool (taskContext)` so tools like `complete_task` and `log_progress` know which task they're acting on. Carries `taskId`, `workflowId`, `slug`, `agentId`, and `assignedBy` — avoids DB lookups in tool implementations.
- **Task context is injected into the system prompt.** When an agent runs a delegated task, a `## Task Context` section is added showing workflowId, taskId, slug, and assignedBy. This gives sub-managers the correct workflow ID for delegation calls.
- **Sub-managers can't create workflows.** `create_workflow` is removed from the tool list when an agent has a task context (`isDelegated=true`). Combined with the `sub-manager` skill (which replaces the `manager` skill via `delegated` gate), sub-managers only delegate within the existing workflow.
- **WorkflowId is enforced in code.** `delegate_task` forces `taskContext.workflowId` when task context exists, ignoring whatever the LLM sends. Belt and suspenders with the system prompt injection.
