import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { api } from "@/lib/api.ts";
import { useWebSocket } from "@/hooks/useWebSocket.ts";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
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

  // Modal state
  const [renameTarget, setRenameTarget] = useState<SessionEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

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

  // Listen for WS events to keep sidebar in sync:
  // - session_renamed: update label in-place
  // - message_out: refetch list (catches new sessions created in this or other tabs)
  const { subscribe } = useWebSocket();
  useEffect(() => {
    const unsub = subscribe((event) => {
      if (event.type === "session_renamed") {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === event.payload.sessionId
              ? { ...s, label: event.payload.label, updatedAt: event.payload.timestamp }
              : s
          ).sort((a, b) => b.updatedAt - a.updatedAt)
        );
      }
      if (event.type === "message_out") {
        fetchSessions();
      }
    });
    return unsub;
  }, [subscribe, fetchSessions]);

  // Listen for local rename/delete events (from Chat header actions)
  useEffect(() => {
    const handleRenamed = (e: Event) => {
      const { sessionId, label } = (e as CustomEvent).detail;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, label, updatedAt: Date.now() } : s
        ).sort((a, b) => b.updatedAt - a.updatedAt)
      );
    };
    const handleDeleted = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    };
    window.addEventListener("session-renamed", handleRenamed);
    window.addEventListener("session-deleted", handleDeleted);
    return () => {
      window.removeEventListener("session-renamed", handleRenamed);
      window.removeEventListener("session-deleted", handleDeleted);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Rename handler
  // -------------------------------------------------------------------------
  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await api.patch(`/api/sessions/${renameTarget.id}`, { label: renameValue.trim() });
      setSessions((prev) => prev.map((s) =>
        s.id === renameTarget.id ? { ...s, label: renameValue.trim() } : s
      ));
      // Notify Chat header to update label
      window.dispatchEvent(new CustomEvent("session-renamed", {
        detail: { sessionId: renameTarget.id, label: renameValue.trim() },
      }));
    } catch {
      // silently fail
    }
    setRenameTarget(null);
  };

  // -------------------------------------------------------------------------
  // Delete handler
  // -------------------------------------------------------------------------
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const wasActive = deleteTarget.id === activeSessionId;
    try {
      await api.delete(`/api/sessions/${deleteTarget.id}`);
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      if (wasActive) onNewChat();
    } catch {
      // silently fail
    }
    setDeleteTarget(null);
  };

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

      {/* Sessions list */}
      <nav className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="px-2 mb-2">
          <span className="text-[13px] font-medium text-muted-foreground/40">Sessions</span>
        </div>
        <div className="space-y-0.5">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <div key={session.id} className={cn(
                "group/session relative rounded-md transition-colors",
                activeSessionId === session.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/40",
              )}>
                <Link
                  to="/chat/$sessionId"
                  params={{ sessionId: session.id }}
                  className={cn(
                    "block px-3 py-1.5 text-[13px] no-underline pr-8",
                    activeSessionId === session.id
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:text-sidebar-accent-foreground",
                  )}
                >
                  <div className="truncate">{session.label}</div>
                  <div className="text-[11px] text-muted-foreground/40">{timeAgo(session.updatedAt)}</div>
                </Link>

                {/* ⋯ menu — visible on hover */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/session:opacity-100 transition-opacity pointer-events-none">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="pointer-events-auto flex items-center justify-center size-6 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <EllipsisVertical className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" sideOffset={8}>
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameValue(session.label);
                          setRenameTarget(session);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget(session)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-1.5 text-[13px] text-muted-foreground/40">
              No sessions yet
            </div>
          )}
        </div>
      </nav>

      {/* Rename modal */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Enter a new name for this chat.</DialogDescription>
          </DialogHeader>
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this chat? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
