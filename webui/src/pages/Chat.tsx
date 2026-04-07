import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { Send, MessageSquare, Loader2 } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket.ts";
import { api } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";
import type { SessionEntry, WsServerEvent } from "@/lib/types.ts";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
}

export function Chat() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const sessionId = params.sessionId;

  const { connected, send, subscribe } = useWebSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [session, setSession] = useState<SessionEntry | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load session info
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setMessages([]);
      return;
    }

    api.get<SessionEntry & { id: string }>(`/api/sessions/${sessionId}`)
      .then((s) => setSession(s))
      .catch(() => setSession(null));

    // TODO: load message history from session JSONL
    setMessages([]);
  }, [sessionId]);

  // Subscribe to WS events
  useEffect(() => {
    const unsub = subscribe((event: WsServerEvent) => {
      if (event.type === "agent_typing") {
        setIsThinking(true);
        setStreamingText("");
      }

      if (event.type === "message_out") {
        setIsThinking(false);
        const text = streamingText || event.payload.text;
        setMessages((prev) => [...prev, {
          role: "assistant",
          text,
          timestamp: event.payload.timestamp,
        }]);
        setStreamingText("");
      }

      if (event.type === "agent_error") {
        setIsThinking(false);
        setStreamingText("");
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: `Error: ${event.payload.error}`,
          timestamp: event.payload.timestamp,
        }]);
      }

      // Token streaming — not yet emitted by backend but ready for when it is
      if (event.type === "token") {
        setStreamingText((prev) => prev + event.payload.text);
      }
    });

    return unsub;
  }, [subscribe, streamingText]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !sessionId || isThinking) return;

    setMessages((prev) => [...prev, { role: "user", text, timestamp: Date.now() }]);
    send({ type: "message", agentId: session?.agentId ?? "atlas", sessionId, text });
    setInput("");
    inputRef.current?.focus();
  }, [input, sessionId, isThinking, send, session]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Empty state — no session selected
  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-3">
        <MessageSquare className="h-12 w-12" />
        <h1 className="text-xl font-semibold text-foreground">Start a conversation</h1>
        <p>Create a new chat or select a session.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      {session && (
        <div className="px-6 py-3 border-b border-border/50 shrink-0">
          <div className="text-sm font-medium text-foreground">{session.label}</div>
          <div className="text-xs text-muted-foreground/50">{session.agentId}</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[70%] rounded-lg px-4 py-2.5 text-sm",
                msg.role === "user"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "bg-card text-card-foreground",
              )}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {(isThinking || streamingText) && (
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-lg px-4 py-2.5 text-sm bg-card text-card-foreground">
              {streamingText ? (
                <div className="whitespace-pre-wrap">{streamingText}</div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground/50">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
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
