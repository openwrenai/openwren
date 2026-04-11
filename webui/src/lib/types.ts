// --- Status ---

export interface StatusResponse {
  uptime: number;
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    role: string | null;
    description: string | null;
  }>;
  agentCount: number;
  sessionCount: number;
  memoryFileCount: number;
  channels: Array<{
    name: string;
    configured: boolean;
  }>;
}

// --- Usage ---

interface TokenPair {
  in: number;
  out: number;
  cachedIn?: number;
}

interface SessionTokenPair extends TokenPair {
  lastActive: string;
}

export interface UsageSummary {
  days: Record<string, TokenPair>;
  byAgent: Record<string, TokenPair>;
  byProvider: Record<string, TokenPair>;
  bySession: Record<string, SessionTokenPair>;
}

// --- Schedules ---

export interface ScheduleJob {
  jobId: string;
  name: string;
  agent: string;
  prompt: string;
  enabled: boolean;
  nextRun: string | null;
}

export interface ScheduleListResponse {
  jobs: ScheduleJob[];
}

// --- Sessions ---

export interface SessionEntry {
  id: string;
  agentId: string;
  label: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionListResponse {
  sessions: SessionEntry[];
}

/**
 * Response from GET /api/sessions/:id/messages — paginated session history.
 * Messages are pre-transformed by the backend into ChatItem-compatible shape.
 */
export interface SessionMessagesResponse {
  messages: Array<{
    kind: "text" | "tool_call";
    role?: "user" | "assistant";
    text?: string;
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: string;
    timestamp: number;
  }>;
  total: number;  // total message count in session — for pagination awareness
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  content: string | MessageContent[];
  ts?: number;
}

export interface MessageContent {
  type: "text" | "tool-call" | "tool-result";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

// --- WebSocket messages (client → server) ---

export interface WsSendMessage {
  type: "message";
  agentId: string;
  sessionId?: string;
  text: string;
}

// --- WebSocket messages (server → client) ---
//
// Event delivery:
//   - token, tool_use, tool_result: sent DIRECTLY to the requesting client
//     via sendTo() in websocket.ts. High-frequency, not broadcast.
//   - message_in, message_out, agent_typing, agent_error: BROADCAST to all
//     connected clients via the bus. System-wide visibility.

/** A single text delta from the streaming LLM response. */
export interface WsTokenEvent {
  type: "token";
  payload: {
    text: string;
    sessionId?: string;  // WebUI session UUID — filter on this to avoid cross-session leaks
  };
}

export interface WsMessageOutEvent {
  type: "message_out";
  payload: {
    agentId: string;
    agentName: string;
    text: string;
    compacted?: boolean;
    sessionId?: string;  // WebUI session UUID — absent for Telegram/Discord events
    timestamp: number;
  };
}

export interface WsAgentTypingEvent {
  type: "agent_typing";
  payload: {
    agentId: string;
    agentName: string;
    sessionId?: string;  // WebUI session UUID — absent for Telegram/Discord events
    timestamp: number;
  };
}

export interface WsErrorEvent {
  type: "error";
  payload: { error: string };
}

export interface WsAgentErrorEvent {
  type: "agent_error";
  payload: {
    agentId: string;
    agentName: string;
    error: string;
    sessionId?: string;  // WebUI session UUID — absent for Telegram/Discord events
    timestamp: number;
  };
}

/** Emitted when a session is auto-renamed after the first agent response. */
export interface WsSessionRenamedEvent {
  type: "session_renamed";
  payload: {
    sessionId: string;
    label: string;
    timestamp: number;
  };
}

/**
 * Received when the agent starts executing a tool call.
 * Frontend renders a ToolCallCard with a spinner.
 */
export interface WsToolUseEvent {
  type: "tool_use";
  payload: {
    agentId: string;
    agentName: string;
    toolCallId: string;   // used to match with the corresponding WsToolResultEvent
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;   // WebUI session UUID — filter on this
    timestamp: number;
  };
}

/**
 * Received when a tool finishes executing.
 * Frontend updates the matching ToolCallCard (by toolCallId) with the result
 * and swaps the spinner for a checkmark. Result is truncated to 500 chars
 * by the backend to avoid flooding the WebSocket.
 */
export interface WsToolResultEvent {
  type: "tool_result";
  payload: {
    agentId: string;
    agentName: string;
    toolCallId: string;   // matches WsToolUseEvent.toolCallId
    toolName: string;
    result: string;       // truncated to 500 chars by websocket.ts
    sessionId?: string;   // WebUI session UUID — filter on this
    timestamp: number;
  };
}

export type WsServerEvent =
  | WsTokenEvent
  | WsMessageOutEvent
  | WsAgentTypingEvent
  | WsErrorEvent
  | WsAgentErrorEvent
  | WsToolUseEvent
  | WsToolResultEvent
  | WsSessionRenamedEvent;
