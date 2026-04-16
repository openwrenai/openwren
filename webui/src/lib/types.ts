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
  schedule: {
    cron?: string;
    every?: string;
    at?: string;
  };
  prompt: string;
  channel: string;
  isolated: boolean;
  enabled: boolean;
  nextRun: string | null;
}

export interface ScheduleListResponse {
  jobs: ScheduleJob[];
}

// --- Sessions ---

/**
 * Response from GET /api/sessions/:agentId/messages — paginated session history.
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
    channel?: string;
    isolated?: boolean;
  }>;
  total: number;
}

// --- Agents ---

export interface Agent {
  id: string;
  name: string;
  model: string | null;
  fallback: string | null;
  role: string | null;
  description: string | null;
  defaultModel?: string;
  defaultFallback?: string;
}

export interface AgentListItem {
  id: string;
  name: string;
}

export interface AgentListResponse {
  agents: AgentListItem[];
}

export interface AgentFile {
  name: string;
  exists: boolean;
}

export interface AgentFilesResponse {
  files: AgentFile[];
}

export interface AgentFileContentResponse {
  name: string;
  content: string;
}

// --- Channels ---

export interface AgentChannel {
  name: string;
}

export interface AgentChannelsResponse {
  channels: AgentChannel[];
}

// --- Teams ---

export interface TeamMember {
  id: string;
  name: string;
}

export interface Team {
  name: string;
  displayName: string;
  manager: TeamMember;
  members: TeamMember[];
}

export interface TeamListResponse {
  teams: Team[];
}

// --- Skills ---

export interface AgentSkill {
  name: string;
  description: string;
  autoload: boolean;
  enabled: boolean;
  blocked: boolean;
  blockReason: string | null;
  source: string;
}

export interface AgentSkillsResponse {
  skills: AgentSkill[];
  total: number;
  enabled: number;
}

// --- Config ---

export interface ConfigResponse {
  config: Record<string, unknown>;
  defaults: Record<string, unknown>;
  _meta: { sensitiveKeys: string[] };
}

export interface ConfigRawResponse {
  content: string;
}

// --- WebSocket messages (client -> server) ---

export interface WsSendMessage {
  type: "message";
  agentId: string;
  text: string;
}

// --- WebSocket messages (server -> client) ---

export interface WsTokenEvent {
  type: "token";
  payload: {
    text: string;
    agentId?: string;
  };
}

export interface WsMessageOutEvent {
  type: "message_out";
  payload: {
    agentId: string;
    agentName: string;
    text: string;
    compacted?: boolean;
    channel?: string;
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

export interface WsToolUseEvent {
  type: "tool_use";
  payload: {
    agentId: string;
    agentName: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    timestamp: number;
  };
}

export interface WsToolResultEvent {
  type: "tool_result";
  payload: {
    agentId: string;
    agentName: string;
    toolCallId: string;
    toolName: string;
    result: string;
    timestamp: number;
  };
}

export interface WsMessageInEvent {
  type: "message_in";
  payload: {
    channel: string;
    userId: string;
    agentId: string;
    agentName: string;
    text: string;
    timestamp: number;
  };
}

export type WsServerEvent =
  | WsTokenEvent
  | WsMessageOutEvent
  | WsMessageInEvent
  | WsAgentTypingEvent
  | WsErrorEvent
  | WsAgentErrorEvent
  | WsToolUseEvent
  | WsToolResultEvent;
