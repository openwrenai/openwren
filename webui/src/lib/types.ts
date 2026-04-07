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
