import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { Loader2, Wrench, ChevronDown, ChevronRight, Check, Pencil, Trash2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { useWebSocket } from "@/hooks/useWebSocket.ts";
import { api } from "@/lib/api.ts";
import { cn, stripTimestamps } from "@/lib/utils.ts";
import { ChatInput } from "@/components/chat/ChatInput.tsx";
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
import type { SessionEntry, SessionMessagesResponse, StatusResponse, WsServerEvent } from "@/lib/types.ts";

// ---------------------------------------------------------------------------
// Chat item types — messages + tool calls rendered in order
// ---------------------------------------------------------------------------

interface TextItem {
  kind: "text";
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
}

interface ToolCallItem {
  kind: "tool_call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  timestamp: number;
}

type ChatItem = TextItem | ToolCallItem;

// ---------------------------------------------------------------------------
// ToolCallCard — collapsible inline card for tool calls
// ---------------------------------------------------------------------------

function ToolCallCard({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = item.result !== undefined;

  // Summarize args for collapsed view
  const summary = Object.entries(item.args)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${val.length > 40 ? val.slice(0, 40) + "…" : val}`;
    })
    .join(", ");

  return (
    <div className="flex justify-start">
      <div className="max-w-[70%] rounded-lg border border-border/50 text-xs font-mono">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-lg"
        >
          {isDone ? (
            <Check className="h-3 w-3 text-emerald-500 shrink-0" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
          )}
          <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">{item.toolName}</span>
          {!expanded && summary && (
            <span className="text-muted-foreground/50 truncate">— {summary}</span>
          )}
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/50 ml-auto shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/50 ml-auto shrink-0" />
          )}
        </button>
        {expanded && (
          <div className="px-3 pb-2 space-y-2 border-t border-border/30">
            <div className="pt-2">
              <div className="text-muted-foreground/60 mb-1">Input:</div>
              <pre className="text-muted-foreground whitespace-pre-wrap break-all">
                {JSON.stringify(item.args, null, 2)}
              </pre>
            </div>
            {isDone && (
              <div>
                <div className="text-muted-foreground/60 mb-1">Result:</div>
                <pre className="text-muted-foreground whitespace-pre-wrap break-all">
                  {item.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Chat page — two-state layout
//
// State 1 (Fresh): no sessionId in URL, no messages. Textarea centered on
//   screen with agent picker inside. Session created lazily on first send.
// State 2 (Active): sessionId in URL, messages exist. Textarea pinned to
//   bottom, messages scroll above, session header at top.
// ---------------------------------------------------------------------------

export function Chat() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();

  const { connected, send, subscribe } = useWebSocket();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [agentId, setAgentId] = useState("atlas");
  const [agents, setAgents] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  // Modal state for session header dropdown
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  // streamingRef tracks the accumulated streaming text as a mutable ref.
  // WHY a ref instead of reading streamingText state:
  // React StrictMode double-invokes state updater functions to verify they're pure.
  // The old code nested setItems() inside setStreamingText() updaters, which caused
  // messages to be added twice. The ref is mutated once per event (not inside an
  // updater), so StrictMode can't double-invoke it.
  const streamingRef = useRef("");
  // activeSessionId tracks the current session. Seeded from URL params, but also
  // updated synchronously during lazy creation (before navigation). This avoids
  // the remount problem: /chat and /chat/:sessionId are separate routes, so
  // navigating between them unmounts/remounts the component and loses all state.
  // By tracking sessionId as state + ref, we keep items and streaming alive
  // across the lazy creation flow.
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(params.sessionId);
  const sessionIdRef = useRef<string | undefined>(params.sessionId);
  const [session, setSession] = useState<SessionEntry | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Pagination state for session history loading
  const [totalMessages, setTotalMessages] = useState(0);  // total in session JSONL
  const isFetchingRef = useRef(false);                     // prevents concurrent fetches

  // Sync activeSessionId when URL params change (e.g. clicking a session in sidebar)
  useEffect(() => {
    if (params.sessionId && params.sessionId !== activeSessionId) {
      setActiveSessionId(params.sessionId);
      sessionIdRef.current = params.sessionId;
      setItems([]);
    }
    if (!params.sessionId && activeSessionId) {
      // Navigated to /chat (New Chat) — reset
      setActiveSessionId(undefined);
      sessionIdRef.current = undefined;
      setItems([]);
      setSession(null);
    }
  }, [params.sessionId]);

  // Fetch agent list once on mount
  useEffect(() => {
    api.get<StatusResponse>("/api/status")
        .then((res) => {
        setAgents(res.agents.map((a) => ({ id: a.id, name: a.name, description: a.description })));
        // Default to first agent if current agentId isn't in the list
        if (res.agents.length > 0 && !res.agents.some((a) => a.id === agentId)) {
          setAgentId(res.agents[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // The "active" state: we have a session AND at least one message.
  // Drives the layout transition from centered (fresh) to bottom-pinned (active).
  const isActive = !!activeSessionId && items.length > 0;

  // Load session metadata + message history when activeSessionId changes.
  // On initial load (clicking an existing session in the sidebar), fetches
  // the last 50 messages and populates items. On lazy creation (first message
  // just sent), items already has the user's message — we merge, not replace.
  useEffect(() => {
    if (!activeSessionId) {
      setSession(null);
      setTotalMessages(0);
      return;
    }

    // Fetch session metadata
    api.get<SessionEntry & { id: string }>(`/api/sessions/${activeSessionId}`)
      .then((s) => setSession(s))
      .catch(() => setSession(null));

    // Fetch message history — only if items is empty (not during lazy creation
    // where the user's first message is already in items)
    if (items.length === 0) {
      api.get<SessionMessagesResponse>(`/api/sessions/${activeSessionId}/messages?limit=50`)
        .then((res) => {
          setTotalMessages(res.total);
          if (res.messages.length > 0) {
            const loaded: ChatItem[] = res.messages.map((m) => {
              if (m.kind === "tool_call") {
                return {
                  kind: "tool_call" as const,
                  toolCallId: m.toolCallId!,
                  toolName: m.toolName!,
                  args: m.args ?? {},
                  result: m.result,
                  timestamp: m.timestamp,
                };
              }
              return {
                kind: "text" as const,
                role: m.role as "user" | "assistant",
                text: m.text ?? "",
                timestamp: m.timestamp,
              };
            });
            setItems(loaded);
            // Jump to bottom after loading history — no smooth scroll
            requestAnimationFrame(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
            });
          }
        })
        .catch(() => {
          // Session exists but messages couldn't be loaded — not fatal
        });
    }
  }, [activeSessionId]);

  // Subscribe to WS events for the active session.
  // All event handlers filter by sessionId to prevent cross-session and
  // cross-channel leaks (e.g. a Telegram response showing up in the WebUI).
  // Events without a sessionId (from Telegram/Discord) are silently ignored.
  useEffect(() => {
    const unsub = subscribe((event: WsServerEvent) => {

      // --- Session filter helper ---
      // Uses sessionIdRef (not the sessionId closure) so it works immediately
      // after lazy session creation, before React re-renders with the new URL.
      // Events without sessionId (Telegram, Discord) are rejected.
      const isMySession = (payload: { sessionId?: string }): boolean =>
        !!sessionIdRef.current && payload.sessionId === sessionIdRef.current;

      if (event.type === "agent_typing") {
        if (!isMySession(event.payload)) return;
        setIsThinking(true);
        streamingRef.current = "";
        setStreamingText("");
      }

      if (event.type === "token") {
        if (!isMySession(event.payload)) return;
        // First token clears the "Thinking..." indicator
        setIsThinking(false);
        // Dual update: ref for synchronous reads in other handlers,
        // state for React to re-render the streaming bubble
        streamingRef.current += event.payload.text;
        setStreamingText(streamingRef.current);
      }

      if (event.type === "tool_use") {
        if (!isMySession(event.payload)) return;
        // Flush: if tokens were streaming and a tool call arrives mid-stream,
        // finalize the accumulated text as a message item BEFORE adding the
        // tool card. This creates the interleaved flow:
        //   streaming text... → [tool card] → streaming text...
        if (streamingRef.current) {
          const flushed = streamingRef.current;
          streamingRef.current = "";
          setStreamingText("");
          setItems((prev) => [...prev, {
            kind: "text",
            role: "assistant",
            text: stripTimestamps(flushed),
            timestamp: Date.now(),
          }]);
        }

        setItems((prev) => [...prev, {
          kind: "tool_call",
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          args: event.payload.args,
          timestamp: event.payload.timestamp,
        }]);
      }

      if (event.type === "tool_result") {
        if (!isMySession(event.payload)) return;
        // Find the matching tool card by toolCallId and set its result.
        // This swaps the spinner for a checkmark in the ToolCallCard.
        setItems((prev) => prev.map((item) =>
          item.kind === "tool_call" && item.toolCallId === event.payload.toolCallId
            ? { ...item, result: event.payload.result }
            : item
        ));
      }

      if (event.type === "message_out") {
        if (!isMySession(event.payload)) return;
        setIsThinking(false);
        // Finalize the response as a single message item.
        // If streaming happened, streamingRef has the full text (prefer it).
        // If streaming didn't happen (non-streaming fallback), use the
        // full response from event.payload.text.
        // Either way, exactly ONE message is added.
        const text = stripTimestamps(streamingRef.current || event.payload.text);
        streamingRef.current = "";
        setStreamingText("");
        if (text) {
          setItems((prev) => [...prev, {
            kind: "text",
            role: "assistant",
            text,
            timestamp: event.payload.timestamp,
          }]);
        }
      }

      if (event.type === "agent_error") {
        if (!isMySession(event.payload)) return;
        setIsThinking(false);
        streamingRef.current = "";
        setStreamingText("");
        setItems((prev) => [...prev, {
          kind: "text",
          role: "assistant",
          text: `Error: ${event.payload.error}`,
          timestamp: event.payload.timestamp,
        }]);
      }

      if (event.type === "session_renamed") {
        if (event.payload.sessionId === sessionIdRef.current) {
          setSession((prev) => prev ? { ...prev, label: event.payload.label } : prev);
        }
      }
    });

    return unsub;
  }, [subscribe]);

  // Listen for local rename events (from sidebar rename)
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId, label } = (e as CustomEvent).detail;
      if (sessionId === sessionIdRef.current) {
        setSession((prev) => prev ? { ...prev, label } : prev);
      }
    };
    window.addEventListener("session-renamed", handler);
    return () => window.removeEventListener("session-renamed", handler);
  }, []);

  // Auto-scroll to bottom on new messages or streaming text
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [items, streamingText]);

  // -------------------------------------------------------------------------
  // Scroll-up prefetch — loads older messages when user scrolls near the top.
  //
  // Triggers at 20% from the top (80% through loaded messages). By the time
  // the user reaches the actual top, the next batch is already loaded.
  // No loading indicator — prefetch is invisible to the user.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Only prefetch if: we have a session, there are more messages to load,
      // and we're not already fetching
      if (!activeSessionId || isFetchingRef.current) return;
      if (items.length >= totalMessages) return;

      // Trigger when scrolled to within 20% of the top
      const threshold = container.scrollHeight * 0.2;
      if (container.scrollTop > threshold) return;

      // Find the oldest message timestamp for the `before` param
      const oldest = items[0]?.timestamp;
      if (!oldest) return;

      isFetchingRef.current = true;
      const prevScrollHeight = container.scrollHeight;

      api.get<SessionMessagesResponse>(
        `/api/sessions/${activeSessionId}/messages?limit=50&before=${oldest}`
      )
        .then((res) => {
          setTotalMessages(res.total);
          if (res.messages.length > 0) {
            const older: ChatItem[] = res.messages.map((m) => {
              if (m.kind === "tool_call") {
                return {
                  kind: "tool_call" as const,
                  toolCallId: m.toolCallId!,
                  toolName: m.toolName!,
                  args: m.args ?? {},
                  result: m.result,
                  timestamp: m.timestamp,
                };
              }
              return {
                kind: "text" as const,
                role: m.role as "user" | "assistant",
                text: m.text ?? "",
                timestamp: m.timestamp,
              };
            });
            // Prepend older messages and maintain scroll position
            setItems((prev) => [...older, ...prev]);
            // After React renders the new items, restore scroll position
            // so the view doesn't jump to the top
            requestAnimationFrame(() => {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop += newScrollHeight - prevScrollHeight;
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          isFetchingRef.current = false;
        });
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeSessionId, items, totalMessages]);

  // -------------------------------------------------------------------------
  // handleSend — lazy session creation
  //
  // Fresh chat (no sessionId): creates session via POST /api/sessions, then
  // navigates to /chat/:sessionId and sends the message. The session file
  // is created on disk at this point, but it's empty until the agent responds.
  //
  // Active chat (has sessionId): sends the message directly via WS.
  // -------------------------------------------------------------------------
  const handleSend = useCallback(async (text: string) => {
    if (!text || isThinking) return;

    // Add user message to the UI immediately (optimistic)
    setItems((prev) => [...prev, { kind: "text", role: "user", text, timestamp: Date.now() }]);

    if (!activeSessionId) {
      // Lazy session creation — create on first message, not on "New Chat"
        try {
          const res = await api.post<{ id: string }>("/api/sessions", {
            agentId,
            label: "New Chat",
        });
          // Update state + ref SYNCHRONOUSLY so the WS event handler can match
          // events for this session immediately
        setActiveSessionId(res.id);
        sessionIdRef.current = res.id;
        // Update URL cosmetically WITHOUT triggering a route change.
        // Using navigate() would unmount this component (different route),
        // destroying all state and the WS subscription mid-stream.
        window.history.replaceState(null, "", `/chat/${res.id}`);
        // Send the message with the newly created sessionId
        send({ type: "message", agentId, sessionId: res.id, text });
        } catch (err) {
        setItems((prev) => [...prev, {
            kind: "text", role: "assistant",
            text: "Error: Failed to create session. Please try again.",
            timestamp: Date.now(),
          }]);
        }
      } else {
        send({ type: "message", agentId: session?.agentId ?? agentId, sessionId: activeSessionId, text });
      }
    }, [activeSessionId, isThinking, send, session, agentId]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const agentDisplayName = agents.find((a) => a.id === (session?.agentId ?? agentId))?.name
    ?? session?.agentId ?? agentId;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  // -------------------------------------------------------------------------
  // Session header actions — rename & delete
  // -------------------------------------------------------------------------

  const handleHeaderRename = async () => {
    if (!activeSessionId || !renameValue.trim()) return;
    try {
      await api.patch(`/api/sessions/${activeSessionId}`, { label: renameValue.trim() });
      setSession((prev) => prev ? { ...prev, label: renameValue.trim() } : prev);
      // Notify sidebar to update label in-place
      window.dispatchEvent(new CustomEvent("session-renamed", {
        detail: { sessionId: activeSessionId, label: renameValue.trim() },
      }));
    } catch {
      // silently fail
    }
    setShowRenameModal(false);
  };

  const handleHeaderDelete = async () => {
    if (!activeSessionId) return;
    try {
      await api.delete(`/api/sessions/${activeSessionId}`);
      window.dispatchEvent(new CustomEvent("session-deleted", {
        detail: { sessionId: activeSessionId },
      }));
      setShowDeleteModal(false);
      setActiveSessionId(undefined);
      sessionIdRef.current = undefined;
      setSession(null);
      setItems([]);
      navigate({ to: "/chat" });
    } catch (err) {

    }
  };

  // -------------------------------------------------------------------------
  // Layout toggles — flip these to experiment
  // -------------------------------------------------------------------------
  const CHAT_WIDTH = "w-[60%]";   // "w-full" | "w-[80%]" | "w-[60%]"
  const ALIGN_MODE = "left";      // "left" = both left-aligned | "split" = user right, assistant left

  // -------------------------------------------------------------------------
  // Render — two-state layout
  // -------------------------------------------------------------------------

  // State 1: Fresh chat — centered input, no messages, no session header
  if (!isActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <div className="w-full max-w-2xl space-y-4">
          <div className="text-center space-y-1 mb-6">
            <h1 className="text-xl font-semibold text-foreground">
              {agents.find((a) => a.id === agentId)?.description ?? "How can I help?"}
            </h1>
            <p className="text-sm text-muted-foreground/50">
                Chat with {agents.find((a) => a.id === agentId)?.name ?? agentId}
            </p>
          </div>

          {!connected && (
            <div className="text-xs text-destructive text-center">Disconnected — reconnecting...</div>
          )}

          <ChatInput
            mode="fresh"
              agentId={agentId}
              onAgentChange={setAgentId}
              agents={agents}
              onSend={handleSend}
              disabled={isThinking}
              connected={connected}
            />
          </div>
        </div>
      );
    }

  // State 2: Active chat — session header, messages, bottom-pinned input
  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      {session && (
        <div className="px-6 py-3 shrink-0 flex items-center">
          <DropdownMenu>
              <DropdownMenuTrigger
                className="group/header flex items-stretch gap-px -ml-4"
              >
              <span className="flex items-center rounded-l-md pl-4 pr-2 py-2 text-sm font-medium text-foreground group-hover/header:bg-sidebar-accent transition-colors">{session.label}</span>
              <span className="flex items-center rounded-r-md px-2 py-2 group-hover/header:bg-sidebar-accent transition-colors">
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuItem
                onClick={() => {
                  setRenameValue(session.label);
                  setShowRenameModal(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setShowDeleteModal(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
      )}

      {/* Messages + tool calls */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4 space-y-1">
        <div className={cn(CHAT_WIDTH, "mx-auto")}>
        {items.map((item, i) =>
          item.kind === "tool_call" ? (
            <ToolCallCard key={`tc-${item.toolCallId}`} item={item} />
          ) : (
            <div
              key={i}
              className={cn(
                ALIGN_MODE === "split" && (item.role === "user" ? "flex justify-end" : "flex justify-start"),
                )}
              >
                <div
                  className={cn(
                    "rounded-lg px-6 py-[25px] text-sm",
                  ALIGN_MODE === "split" && "max-w-[70%]",
                  item.role === "user"
                    ? "bg-card"
                    : "text-foreground/80",
                )}
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <span className={cn(
                    "text-sm font-semibold",
                    item.role === "user" ? "text-blue-400" : "text-emerald-400",
                )}>
                    {item.role === "user" ? "You" : agentDisplayName}
                </span>
                  {item.timestamp && (
                    <span className="text-[11px] text-muted-foreground/40">
                      {formatTime(item.timestamp)}
                    </span>
                )}
                </div>
                <Streamdown plugins={{ code }}>{item.text}</Streamdown>
              </div>
            </div>
          )
          )}

          {/* Streaming text indicator */}
        {streamingText && (
          <div className="rounded-lg px-6 py-[25px] text-sm text-foreground/80">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold text-emerald-400">{agentDisplayName}</span>
              </div>
            <Streamdown plugins={{ code }}>{streamingText}</Streamdown>
            </div>
          )}

          {/* Thinking indicator — only when no tokens have arrived yet */}
          {isThinking && !streamingText && (
          <div className="rounded-lg px-6 py-[25px] text-sm">
              <div className="flex items-baseline gap-2 mb-1">
              <span className="text-sm font-semibold text-emerald-400">{agentDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground/50">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
          </div>
      </div>

      {/* Input area — pinned to bottom */}
      <div className="py-4 border-t border-border/50 shrink-0">
          <div className={cn(CHAT_WIDTH, "mx-auto")}>
        {!connected && (
          <div className="text-xs text-destructive mb-2">Disconnected — reconnecting...</div>
        )}
        <ChatInput
          mode="active"
            agentId={session?.agentId ?? agentId}
            onAgentChange={setAgentId}
            agents={agents}
            onSend={handleSend}
            disabled={isThinking}
            connected={connected}
          />
          </div>
        </div>

    {/* Rename modal */}
      <Dialog open={showRenameModal} onOpenChange={setShowRenameModal}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Enter a new name for this chat.</DialogDescription>
          </DialogHeader>
          <input
          type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleHeaderRename()}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
          />
          <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleHeaderRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
            Are you sure you want to delete this chat? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleHeaderDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
