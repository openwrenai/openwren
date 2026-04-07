// --- Status ---

export interface StatusResponse {
  uptime: number;
  agents: Array<{
    id: string;
    name: string;
    model: string | null;
    role: string | null;
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

export interface WsTokenEvent {
  type: "token";
  payload: { text: string };
}

export interface WsMessageOutEvent {
  type: "message_out";
  payload: {
    agentId: string;
    agentName: string;
    text: string;
    compacted?: boolean;
    timestamp: number;
  };
}

export interface WsAgentTypingEvent {
  type: "agent_typing";
  payload: {
    agentId: string;
    agentName: string;
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
    timestamp: number;
  };
}

export type WsServerEvent =
  | WsTokenEvent
  | WsMessageOutEvent
  | WsAgentTypingEvent
  | WsErrorEvent
  | WsAgentErrorEvent;
