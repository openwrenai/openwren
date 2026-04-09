import { useEffect, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { api } from "@/lib/api.ts";
import type { SessionEntry, SessionListResponse } from "@/lib/types.ts";

interface ChatSidebarProps {
  activeSessionId?: string;
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

export function ChatSidebar({ activeSessionId, onNewChat }: ChatSidebarProps) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await api.get<SessionListResponse>("/api/sessions");
      setSessions(res.sessions);
    } catch {
      // silently fail — sidebar still renders with empty state
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden">
      {/* New chat */}
      <div className="px-4 pt-5 pb-2">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-[14px] font-medium hover:bg-sidebar-accent/80 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
      </div>

      {/* Sessions list — all sessions, sorted by updatedAt (API handles sorting) */}
      <nav className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="px-2 mb-2">
          <span className="text-[13px] font-medium text-muted-foreground/40">Sessions</span>
        </div>
        <div className="space-y-0.5">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <Link
                key={session.id}
                to="/chat/$sessionId"
                params={{ sessionId: session.id }}
                className={cn(
                  "block px-3 py-1.5 rounded-md text-[13px] transition-colors no-underline",
                  activeSessionId === session.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
                )}
              >
                <div className="truncate">{session.label}</div>
                <div className="text-[11px] text-muted-foreground/40">{timeAgo(session.updatedAt)}</div>
                </Link>
            ))
          ) : (
            <div className="px-3 py-1.5 text-[13px] text-muted-foreground/40">
              No sessions yet
              </div>
          )}
        </div>
      </nav>
    </aside>
  );
}
