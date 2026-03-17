/**
 * Typed Event Bus
 *
 * Event system serving two purposes:
 * 1. Cross-channel visibility — channels emit events as side effects,
 *    WS clients subscribe for live status (CLI, Web UI).
 * 2. Orchestration triggers — task/workflow events drive the dependency
 *    resolver and notification system (code, not LLM).
 *
 * Events are lightweight triggers — all state lives in SQLite or JSONL.
 * The agent loop is completely unaware of this module.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Event payloads — one interface per bus event
// ---------------------------------------------------------------------------

/** A user sent a message to an agent (emitted by every channel adapter). */
export interface MessageInEvent {
  channel: string;   // "telegram" | "discord" | "websocket"
  userId: string;    // config-level user ID (e.g. "owner")
  agentId: string;   // config key (e.g. "atlas", "einstein")
  agentName: string; // display name (e.g. "Atlas")
  text: string;      // raw message text
  timestamp: number; // UTC ms (Date.now())
}

/** An agent finished responding (emitted after the agent loop returns). */
export interface MessageOutEvent {
  channel: string;
  userId: string;
  agentId: string;
  agentName: string;
  text: string;           // the agent's reply
  compacted: boolean;     // true if the session was compacted during this turn
  nearThreshold: boolean; // true if token estimate is approaching compaction threshold
  timestamp: number;
}

/** An agent is "thinking" — the LLM call is in flight (typing indicator). */
export interface AgentTypingEvent {
  channel: string;
  userId: string;
  agentId: string;
  agentName: string;
  timestamp: number;
}

/** A session was compacted — old messages summarized and archived. */
export interface SessionCompactedEvent {
  userId: string;
  agentId: string;
  timestamp: number;
}

/** The agent loop threw an error while processing a message. */
export interface AgentErrorEvent {
  channel: string;
  userId: string;
  agentId: string;
  agentName: string;
  error: string; // error message string
  timestamp: number;
}

/** System status snapshot — returned in response to a WS "status" request. */
export interface StatusEvent {
  agents: Array<{ id: string; name: string }>;
  channels: string[]; // names of active channels
  uptime: number;     // seconds since process start
  scheduler: {
    enabled: boolean;
    jobs: { total: number; enabled: number };
    nextRun: { jobId: string | null; time: string } | null;
    queuePending: number;
    queueProcessing: boolean;
  } | null;           // null when scheduler is disabled or not yet started
  timestamp: number;
}

/** A tool needs user confirmation — sent to the specific WS client that triggered it. */
export interface ConfirmRequestEvent {
  nonce: string;     // unique ID — client echoes this back with yes/no/always
  agentId: string;
  agentName: string;
  command: string;   // the shell command awaiting approval
  timestamp: number;
}

/** A scheduled job completed a run (ok or suppressed). */
export interface ScheduleRunEvent {
  jobId: string;
  agentId: string;
  agentName: string;
  status: "ok";
  suppressed: boolean; // true if HEARTBEAT_OK
  timestamp: number;
}

/** A scheduled job failed. */
export interface ScheduleErrorEvent {
  jobId: string;
  agentId: string;
  agentName: string;
  error: string;
  errorType: "transient" | "permanent";
  timestamp: number;
}

/** A task began executing — runner picked it up from the queue. */
export interface TaskStartedEvent {
  taskId: number;
  slug: string;
  workflowId: number;
  agentId: string;
  timestamp: number;
}

/** A task completed successfully — agent called complete_task or auto-completed. */
export interface TaskCompletedEvent {
  taskId: number;
  slug: string;
  workflowId: number;
  agentId: string;
  assignedBy: string;   // manager agent that delegated this task
  summary: string;
  deliverables?: string; // comma-separated file paths or description
  timestamp: number;
}

/** A task failed — agent loop crashed or returned an error. */
export interface TaskFailedEvent {
  taskId: number;
  slug: string;
  workflowId: number;
  agentId: string;
  assignedBy: string;
  error: string;
  timestamp: number;
}

/** All tasks in a workflow completed — the entire DAG is done. */
export interface WorkflowCompletedEvent {
  workflowId: number;
  slug: string;
  name: string;
  managerAgentId: string;
  summary: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Event map — ties event names to their payload types for compile-time safety
// ---------------------------------------------------------------------------

export interface BusEvents {
  message_in: MessageInEvent;
  message_out: MessageOutEvent;
  agent_typing: AgentTypingEvent;
  session_compacted: SessionCompactedEvent;
  agent_error: AgentErrorEvent;
  status: StatusEvent;
  confirm_request: ConfirmRequestEvent;
  schedule_run: ScheduleRunEvent;
  schedule_error: ScheduleErrorEvent;
  task_started: TaskStartedEvent;
  task_completed: TaskCompletedEvent;
  task_failed: TaskFailedEvent;
  workflow_completed: WorkflowCompletedEvent;
}

export type BusEventName = keyof BusEvents;

// ---------------------------------------------------------------------------
// TypedEventBus — thin wrapper around EventEmitter with generic type safety
//
// Standard EventEmitter is untyped (emit/on accept `any`). This wrapper
// constrains event names and payloads at compile time via the BusEvents map.
// ---------------------------------------------------------------------------

class TypedEventBus {
  private emitter = new EventEmitter();

  /** Emit an event to all registered listeners. */
  emit<K extends BusEventName>(event: K, payload: BusEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  /** Subscribe to an event. */
  on<K extends BusEventName>(event: K, listener: (payload: BusEvents[K]) => void): void {
    this.emitter.on(event, listener);
  }

  /** Unsubscribe from an event. */
  off<K extends BusEventName>(event: K, listener: (payload: BusEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }
}

/**
 * Global event bus singleton.
 *
 * Imported by channel adapters (telegram.ts, discord.ts, websocket.ts) to
 * emit events, and by the WebSocket channel to broadcast them to clients.
 */
export const bus = new TypedEventBus();
