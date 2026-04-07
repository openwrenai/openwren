import { useEffect, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { api } from "@/lib/api.ts";
import type { SessionEntry, SessionListResponse, StatusResponse } from "@/lib/types.ts";

interface ChatSidebarProps {
  activeSessionId?: string;
  activeAgentId: string;
  onAgentChange: (agentId: string) => void;
  onNewChat: () => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ChatSidebar({ activeSessionId, activeAgentId, onAgentChange, onNewChat }: ChatSidebarProps) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [agents, setAgents] = useState<StatusResponse["agents"]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [sessRes, statusRes] = await Promise.all([
        api.get<SessionListResponse>("/api/sessions"),
        api.get<StatusResponse>("/api/status"),
      ]);
      setSessions(sessRes.sessions);
      setAgents(statusRes.agents);
    } catch {
      // silently fail — sidebar still renders with empty state
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Group sessions by agent
  const agentSessions = sessions.filter((s) => s.agentId === activeAgentId);

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-background text-sidebar-foreground overflow-hidden">
      {/* New chat + agent selector */}
      <div className="px-4 pt-5 pb-2 space-y-3">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-[14px] font-medium hover:bg-sidebar-accent/80 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>

        {/* Agent selector */}
        <select
          value={activeAgentId}
          onChange={(e) => onAgentChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Sessions list */}
      <nav className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="px-2 mb-2">
          <span className="text-[13px] font-medium text-muted-foreground/40">Sessions</span>
        </div>
        <div className="space-y-0.5">
          {agentSessions.length > 0 ? (
            agentSessions.map((session) => (
              <Link
                key={session.id}
                to="/chat/$sessionId"
                params={{ sessionId: session.id }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-colors no-underline",
                  activeSessionId === session.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{session.label}</div>
                  <div className="text-[11px] text-muted-foreground/40">{timeAgo(session.updatedAt)}</div>
                </div>
              </Link>
            ))
          ) : (
            <div className="flex items-center gap-3 px-3 py-2.5 text-[13px] text-muted-foreground/40">
              <MessageSquare className="h-4 w-4 shrink-0" />
              No sessions yet
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}
