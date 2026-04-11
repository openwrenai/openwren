import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2, Wrench, ChevronDown, ChevronRight, Check, Trash2 } from "lucide-react";
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
import type { SessionMessagesResponse, WsServerEvent } from "@/lib/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract job label from scheduler message content like "[Daily Digest] ..." or "[job:id] ..." */
function parseJobLabel(text: string): { label: string; body: string } | null {
  const m = text.match(/^\[([^\]]+)\]\s*/);
  if (!m) return null;
  const raw = m[1];
  const label = raw.startsWith("job:") ? raw.slice(4) : raw;
  return { label, body: text.slice(m[0].length) };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentSession {
  agentId: string;
  agentName: string;
  hasHistory: boolean;
}

interface TextItem {
  kind: "text";
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
  channel?: string;
  isolated?: boolean;
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
// ToolCallCard
// ---------------------------------------------------------------------------

function ToolCallCard({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = item.result !== undefined;

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
// Chat page
// ---------------------------------------------------------------------------

export function Chat() {
  const { connected, send, subscribe } = useWebSocket();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [agentId, setAgentId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const [totalMessages, setTotalMessages] = useState(0);
  const isFetchingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showClearModal, setShowClearModal] = useState(false);

  // Fetch available sessions on mount
  useEffect(() => {
    api.get<{ sessions: AgentSession[] }>("/api/sessions")
      .then((res) => {
        setSessions(res.sessions);
        if (res.sessions.length > 0 && !agentId) {
          setAgentId(res.sessions[0].agentId);
        }
      })
      .catch(() => {});
  }, []);

  // Load messages when agentId changes
  useEffect(() => {
    if (!agentId) return;
    setItems([]);
    setTotalMessages(0);
    api.get<SessionMessagesResponse>(`/api/sessions/${agentId}/messages?limit=50`)
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
                ...(m.channel ? { channel: m.channel } : {}),
              ...(m.isolated ? { isolated: true } : {}),
            };
          });
          setItems(loaded);
          requestAnimationFrame(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
          });
        }
      })
      .catch(() => {});
  }, [agentId]);

  // Subscribe to WS events — filter by agentId
  useEffect(() => {
    const unsub = subscribe((event: WsServerEvent) => {
      const isMyAgent = (payload: { agentId?: string }): boolean =>
        !!agentId && payload.agentId === agentId;

        // Cross-channel: show Telegram/Discord user messages in WebUI
        if (event.type === "message_in") {
          if (!isMyAgent(event.payload)) return;
          if (event.payload.channel === "websocket") return; // already added optimistically
          setItems((prev) => [...prev, {
            kind: "text",
            role: "user",
            text: event.payload.text,
            timestamp: event.payload.timestamp,
              channel: event.payload.channel,
          }]);
        }

        if (event.type === "agent_typing") {
        if (!isMyAgent(event.payload)) return;
        setIsThinking(true);
        streamingRef.current = "";
        setStreamingText("");
      }

      if (event.type === "token") {
        if (!isMyAgent(event.payload)) return;
        setIsThinking(false);
        streamingRef.current += event.payload.text;
        setStreamingText(streamingRef.current);
      }

      if (event.type === "tool_use") {
        if (!isMyAgent(event.payload)) return;
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
        if (!isMyAgent(event.payload)) return;
        setItems((prev) => prev.map((item) =>
          item.kind === "tool_call" && item.toolCallId === event.payload.toolCallId
            ? { ...item, result: event.payload.result }
            : item
        ));
      }

      if (event.type === "message_out") {
        if (!isMyAgent(event.payload)) return;
        setIsThinking(false);
        const text = stripTimestamps(streamingRef.current || event.payload.text);
        streamingRef.current = "";
        setStreamingText("");
        if (text) {
          setItems((prev) => [...prev, {
            kind: "text",
            role: "assistant",
            text,
            timestamp: event.payload.timestamp,
              ...(event.payload.channel && event.payload.channel !== "websocket" ? { channel: event.payload.channel } : {}),
          }]);
        }
      }

      if (event.type === "agent_error") {
        if (!isMyAgent(event.payload)) return;
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
  }, [subscribe, agentId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [items, streamingText]);

  // Scroll-up prefetch
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !agentId) return;
    if (items.length === 0 || items.length >= totalMessages) return;

    const handleScroll = () => {
      if (isFetchingRef.current) return;
      const threshold = container.scrollHeight * 0.2;
      if (container.scrollTop > threshold) return;
      const oldest = items[0]?.timestamp;
      if (!oldest) return;

      isFetchingRef.current = true;
      const prevScrollHeight = container.scrollHeight;

      api.get<SessionMessagesResponse>(
        `/api/sessions/${agentId}/messages?limit=50&before=${oldest}`
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
                  ...(m.channel ? { channel: m.channel } : {}),
                ...(m.isolated ? { isolated: true } : {}),
              };
            });
            setItems((prev) => [...older, ...prev]);
            requestAnimationFrame(() => {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop += newScrollHeight - prevScrollHeight;
            });
          }
        })
        .catch(() => {})
        .finally(() => { isFetchingRef.current = false; });
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [agentId, items, totalMessages]);

  // Send message
  const handleSend = useCallback((text: string) => {
    if (!text || isThinking || !agentId) return;
    setItems((prev) => [...prev, { kind: "text", role: "user", text, timestamp: Date.now() }]);
    send({ type: "message", agentId, text });
  }, [agentId, isThinking, send]);

  // Clear conversation
  const handleClear = async () => {
    if (!agentId) return;
    try {
      await api.post(`/api/sessions/${agentId}/clear`);
      setItems([]);
      setTotalMessages(0);
      setStreamingText("");
      streamingRef.current = "";
    } catch {}
    setShowClearModal(false);
  };

  // Render helpers
  const currentSession = sessions.find((s) => s.agentId === agentId);
  const agentDisplayName = currentSession?.agentName ?? agentId;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const CHAT_WIDTH = "w-[60%]";

  return (
    <div className="flex flex-col h-full -m-8">
      {/* Header — session picker + clear button */}
      <div className="px-6 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="group/header flex items-stretch gap-px">
              <span className="flex items-center rounded-l-md pl-4 pr-2 py-2 text-sm font-medium text-foreground group-hover/header:bg-sidebar-accent transition-colors">
                {agentDisplayName} Session
              </span>
              <span className="flex items-center rounded-r-md px-2 py-2 group-hover/header:bg-sidebar-accent transition-colors">
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4}>
              {sessions.map((s) => (
                <DropdownMenuItem
                  key={s.agentId}
                  onClick={() => setAgentId(s.agentId)}
                >
                  {s.agentName} Session
                  {s.agentId === agentId && <Check className="h-3.5 w-3.5 ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          onClick={() => setShowClearModal(true)}
          disabled={items.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4 space-y-1">
        <div className={cn(CHAT_WIDTH, "mx-auto space-y-2")}>
          {items.map((item, i) => {
            // Hide scheduler prompts — only show the agent's response
              if (item.kind === "text" && item.role === "user" && item.channel === "scheduler") {
                return null;
              }

              if (item.kind === "tool_call") {
              return <ToolCallCard key={`tc-${item.toolCallId}`} item={item} />;
              }

              const jobInfo = item.channel === "scheduler" ? parseJobLabel(item.text) : null;
              const displayText = jobInfo ? jobInfo.body : item.text;

              const displayName = item.role === "user" ? "You" : agentDisplayName;

              return (
              <div key={i}>
                  <div
                    className={cn(
                      "rounded-lg px-6 py-[25px] text-sm",
                      !item.isolated && "ring-1 ring-foreground/10 dark:ring-muted-foreground/20",
                      item.channel === "scheduler" && !item.isolated ? "bg-card/30 opacity-80" : item.isolated ? "bg-card/20" : "bg-card/50",
                      item.isolated && "border border-dashed border-muted-foreground/40",
                    )}
                >
                    <div className="flex items-baseline justify-between mb-1">
                      <div className="flex items-baseline gap-2">
                        {item.channel === "scheduler" && jobInfo ? (
                        <span className="text-sm font-semibold text-emerald-400">{agentDisplayName}</span>
                        ) : (
                          <span className={cn(
                            "text-sm font-semibold",
                            item.role === "user" ? "text-blue-400" : "text-emerald-400",
                          )}>
                            {displayName}
                          </span>
                        )}
                        {item.timestamp && (
                          <span className="text-[11px] text-muted-foreground/40">
                            {formatTime(item.timestamp)}
                          </span>
                        )}
                      </div>
                      {item.channel === "scheduler" ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
                          Scheduled Job
                        </span>
                      ) : item.role === "user" && item.channel && item.channel !== "webui" ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                        via {item.channel.charAt(0).toUpperCase() + item.channel.slice(1)}
                      </span>
                      ) : null}
                    </div>
                    {item.channel === "scheduler" && jobInfo && (
                      <div className="text-[13px] font-semibold mb-2">[{jobInfo.label}]</div>
                    )}
                    <Streamdown plugins={{ code }}>{displayText}</Streamdown>
                  </div>
                </div>
              );
            })}

          {/* Streaming */}
          {streamingText && (
            <div className="rounded-lg px-6 py-[25px] text-sm text-foreground/80">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold text-emerald-400">{agentDisplayName}</span>
              </div>
              <Streamdown plugins={{ code }}>{streamingText}</Streamdown>
            </div>
          )}

          {/* Thinking */}
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

      {/* Input */}
      <div className="py-4 border-t border-border/50 shrink-0">
        <div className={cn(CHAT_WIDTH, "mx-auto")}>
          {!connected && (
            <div className="text-xs text-destructive mb-2">Disconnected — reconnecting...</div>
          )}
          <ChatInput
            onSend={handleSend}
            disabled={isThinking || !agentId}
            connected={connected}
          />
        </div>
      </div>

      {/* Clear conversation modal */}
      <Dialog open={showClearModal} onOpenChange={setShowClearModal}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Clear conversation</DialogTitle>
            <DialogDescription>
              This will archive the current conversation and start fresh. You can't undo this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleClear}>Clear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
