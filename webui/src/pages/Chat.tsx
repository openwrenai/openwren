import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { Send, MessageSquare, Loader2, Wrench, ChevronDown, ChevronRight, Check } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket.ts";
import { api } from "@/lib/api.ts";
import { cn, stripTimestamps } from "@/lib/utils.ts";
import type { SessionEntry, SessionMessagesResponse, WsServerEvent } from "@/lib/types.ts";

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
// Auto-growing textarea hook
//
// Adjusts textarea height to fit content. Resets to single row when value
// is cleared (after sending a message). Works in both centered (fresh) and
// bottom-pinned (active) states.
// ---------------------------------------------------------------------------

function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [ref, value]);
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

  const { connected, send, subscribe } = useWebSocket();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  // Auto-grow textarea as user types or adds newlines with Shift+Enter
  useAutoResize(inputRef, input);

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
    });

    return unsub;
  }, [subscribe]);

  // Auto-scroll to bottom on new messages or streaming text
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    // Add user message to the UI immediately (optimistic)
    setItems((prev) => [...prev, { kind: "text", role: "user", text, timestamp: Date.now() }]);
    setInput("");

    if (!activeSessionId) {
      // Lazy session creation — create on first message, not on "New Chat"
      try {
        const agentId = session?.agentId ?? "atlas";
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
        console.error("Failed to create session:", err);
        setItems((prev) => [...prev, {
          kind: "text", role: "assistant",
          text: "Error: Failed to create session. Please try again.",
          timestamp: Date.now(),
        }]);
      }
    } else {
      send({ type: "message", agentId: session?.agentId ?? "atlas", sessionId: activeSessionId, text });
    }

    inputRef.current?.focus();
  }, [input, activeSessionId, isThinking, send, session]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

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
              How can I help?
            </h1>
            <p className="text-sm text-muted-foreground/50">Start a conversation</p>
          </div>

          {!connected && (
            <div className="text-xs text-destructive text-center">Disconnected — reconnecting...</div>
          )}

          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              autoFocus
              disabled={!connected || isThinking}
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected || isThinking}
              className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Active chat — session header, messages, bottom-pinned input
  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      {session && (
        <div className="px-6 py-3 border-b border-border/50 shrink-0">
          <div className="text-sm font-medium text-foreground">{session.label}</div>
          <div className="text-xs text-muted-foreground/50">{session.agentId}</div>
        </div>
      )}

      {/* Messages + tool calls */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {items.map((item, i) =>
          item.kind === "tool_call" ? (
            <ToolCallCard key={`tc-${item.toolCallId}`} item={item} />
          ) : (
            <div
              key={i}
              className={cn(
                "flex",
                item.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[70%] rounded-lg px-4 py-2.5 text-sm",
                  item.role === "user"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "bg-card text-card-foreground",
                )}
              >
                <div className="whitespace-pre-wrap">{item.text}</div>
              </div>
            </div>
          )
        )}

        {/* Streaming text indicator */}
        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-lg px-4 py-2.5 text-sm bg-card text-card-foreground">
              <div className="whitespace-pre-wrap">{streamingText}</div>
            </div>
          </div>
        )}

        {/* Thinking indicator — only when no tokens have arrived yet */}
        {isThinking && !streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-lg px-4 py-2.5 text-sm bg-card text-card-foreground">
              <div className="flex items-center gap-2 text-muted-foreground/50">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area — pinned to bottom */}
      <div className="px-6 py-4 border-t border-border/50 shrink-0">
        {!connected && (
          <div className="text-xs text-destructive mb-2">Disconnected — reconnecting...</div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={!connected || isThinking}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected || isThinking}
            className="px-4 py-2.5 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-sm font-medium hover:bg-sidebar-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
